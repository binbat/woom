//! Audio pipeline: Opus RTP payload -> 48 kHz stereo decode -> mono downmix
//! -> 48/16 kHz resample -> little-endian i16 PCM bytes.
//!
//! DTX/comfort-noise gaps are handled by simply not producing output: only
//! packets that actually arrive are decoded, nothing is synthesized.

use anyhow::{Context, Result};
use opus::{Channels, Decoder as OpusDecoder};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};

pub const OPUS_SAMPLE_RATE: u32 = 48_000;
pub const OUT_SAMPLE_RATE: u32 = 16_000;

/// Maximum Opus frame duration is 120 ms: 5760 samples per channel at 48 kHz.
const MAX_OPUS_FRAME_SAMPLES: usize = 5760;
/// Resampler input chunk: 20 ms at 48 kHz, the standard WebRTC audio frame.
const RESAMPLE_CHUNK_IN: usize = 960;

/// Opus decoder + mono downmix + 48 kHz -> 16 kHz resampler for one speaker.
pub struct OpusToPcm {
    decoder: OpusDecoder,
    resampler: Async<f32>,
    stereo_buf: Vec<i16>,
    /// Mono f32 samples waiting to fill a resampler input chunk.
    pending: Vec<f32>,
}

impl OpusToPcm {
    pub fn new() -> Result<Self> {
        // WebRTC negotiates Opus as 48 kHz stereo regardless of the source
        // channel count; decoding as stereo always works.
        let decoder =
            OpusDecoder::new(OPUS_SAMPLE_RATE, Channels::Stereo).context("create Opus decoder")?;
        let params = SincInterpolationParameters::new(64, WindowFunction::BlackmanHarris2)
            .interpolation(SincInterpolationType::Linear);
        let resampler = Async::new_sinc(
            f64::from(OUT_SAMPLE_RATE) / f64::from(OPUS_SAMPLE_RATE),
            1.0,
            &params,
            RESAMPLE_CHUNK_IN,
            1,
            FixedAsync::Input,
        )
        .context("create resampler")?;
        Ok(Self {
            decoder,
            resampler,
            stereo_buf: vec![0; MAX_OPUS_FRAME_SAMPLES * 2],
            pending: Vec::with_capacity(RESAMPLE_CHUNK_IN * 4),
        })
    }

    /// Decode one Opus RTP payload. Returns 16 kHz mono s16le PCM bytes;
    /// empty when fewer than 20 ms of audio are buffered, so callers should
    /// treat empty output as normal, not as an error.
    pub fn process(&mut self, opus_payload: &[u8]) -> Result<Vec<u8>> {
        let samples_per_channel = self
            .decoder
            .decode(opus_payload, &mut self.stereo_buf, false)
            .context("decode Opus packet")?;
        let stereo = &self.stereo_buf[..samples_per_channel * 2];
        downmix_stereo_to_mono(stereo, &mut self.pending);

        let mut out = Vec::new();
        while self.pending.len() >= RESAMPLE_CHUNK_IN {
            let chunk: Vec<f32> = self.pending.drain(..RESAMPLE_CHUNK_IN).collect();
            let adapter = InterleavedSlice::new(&chunk, 1, RESAMPLE_CHUNK_IN)
                .context("wrap mono chunk for resampler")?;
            let resampled = self
                .resampler
                .process(&adapter, None)
                .context("resample 48 kHz -> 16 kHz")?;
            for sample in resampled.take_data() {
                out.extend_from_slice(&f32_to_i16(sample).to_le_bytes());
            }
        }
        Ok(out)
    }
}

/// Average interleaved stereo i16 into mono f32 samples in [-1.0, 1.0].
fn downmix_stereo_to_mono(stereo: &[i16], out: &mut Vec<f32>) {
    out.reserve(stereo.len() / 2);
    for pair in stereo.as_chunks::<2>().0 {
        let left = f32::from(pair[0]);
        let right = f32::from(pair[1]);
        out.push((left + right) * 0.5 / 32768.0);
    }
}

fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

/// Accumulates a byte stream and emits fixed-size chunks; used to turn the
/// resampler's variable-size output into ~100 ms STT frames.
pub struct Chunker {
    buf: Vec<u8>,
    chunk_size: usize,
}

impl Chunker {
    pub fn new(chunk_size: usize) -> Self {
        Self {
            buf: Vec::with_capacity(chunk_size * 2),
            chunk_size,
        }
    }

    /// Append data; returns every complete chunk, in order.
    pub fn push(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(data);
        let complete = self.buf.len() / self.chunk_size;
        if complete == 0 {
            return Vec::new();
        }
        self.buf
            .drain(..complete * self.chunk_size)
            .collect::<Vec<u8>>()
            .chunks(self.chunk_size)
            .map(|chunk| chunk.to_vec())
            .collect()
    }

    /// Take whatever is left (a partial chunk), if anything.
    pub fn flush(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buf))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opus::{Application, Encoder as OpusEncoder};

    #[test]
    fn downmix_averages_channels() {
        let stereo = [1000i16, -1000, 32767, 32767, -32768, 0];
        let mut mono = Vec::new();
        downmix_stereo_to_mono(&stereo, &mut mono);
        assert_eq!(mono.len(), 3);
        assert!(mono[0].abs() < 1e-6, "average of +1000/-1000 is 0");
        assert!((mono[1] - 32767.0 / 32768.0).abs() < 1e-6);
        assert!((mono[2] - (-0.5)).abs() < 1e-4);
    }

    #[test]
    fn f32_to_i16_clamps_and_rounds() {
        assert_eq!(f32_to_i16(0.0), 0);
        assert_eq!(f32_to_i16(1.0), 32767);
        assert_eq!(f32_to_i16(2.5), 32767);
        assert_eq!(f32_to_i16(-1.0), -32767);
        assert_eq!(f32_to_i16(-5.0), -32767);
    }

    #[test]
    fn chunker_emits_fixed_chunks_in_order() {
        let mut chunker = Chunker::new(4);
        assert!(chunker.push(&[1, 2, 3]).is_empty());
        assert_eq!(
            chunker.push(&[4, 5, 6, 7, 8, 9]),
            vec![vec![1, 2, 3, 4], vec![5, 6, 7, 8]]
        );
        assert!(chunker.push(&[]).is_empty());
        assert_eq!(chunker.flush(), Some(vec![9]));
        assert_eq!(chunker.flush(), None);
    }

    /// Encode a 440 Hz tone with libopus, run it through the pipeline, and
    /// verify the output length tracks the 48 kHz -> 16 kHz ratio.
    #[test]
    fn opus_tone_decodes_and_resamples_to_one_third_rate() {
        let mut encoder =
            OpusEncoder::new(OPUS_SAMPLE_RATE, Channels::Stereo, Application::Audio).unwrap();
        let mut pipeline = OpusToPcm::new().unwrap();

        // 50 frames of 20 ms = 1 second of audio.
        let mut pcm_out = Vec::new();
        let mut packet = vec![0u8; 4000];
        for frame in 0..50u32 {
            let mut stereo = vec![0i16; 960 * 2];
            for (i, sample) in stereo.iter_mut().enumerate() {
                let t = (frame as usize * 960 + i / 2) as f32 / OPUS_SAMPLE_RATE as f32;
                *sample = ((t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 10000.0) as i16;
            }
            let len = encoder.encode(&stereo, &mut packet).unwrap();
            let out = pipeline.process(&packet[..len]).unwrap();
            pcm_out.extend_from_slice(&out);
        }

        // 1 second at 16 kHz mono s16le is 32000 bytes; allow 5% slack for
        // resampler latency and asynchronous output-size jitter.
        let expected = OUT_SAMPLE_RATE as usize * 2;
        let slack = expected / 20;
        assert!(
            pcm_out.len() > expected - slack && pcm_out.len() < expected + slack,
            "expected ~{expected} bytes of PCM, got {}",
            pcm_out.len()
        );
        // A decoded sine wave is not silence.
        let max_amplitude = pcm_out
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| i16::from_le_bytes(*c).abs())
            .max()
            .unwrap_or(0);
        assert!(max_amplitude > 1000, "decoded audio is not silent");
    }

    #[test]
    fn invalid_opus_payload_is_an_error_not_a_panic() {
        let mut pipeline = OpusToPcm::new().unwrap();
        assert!(pipeline.process(&[0xff, 0xff, 0xff, 0xff]).is_err());
    }
}
