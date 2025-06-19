export default class VolumeExtractor {
  private audioContext: AudioContext
  private source: MediaStreamAudioSourceNode
  private analyser: AnalyserNode
  private dataArray: Uint8Array
  private bufferLength: number

  constructor(stream: MediaStream) {
    this.audioContext = new AudioContext()
    this.source = this.audioContext.createMediaStreamSource(stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 512
    this.bufferLength = this.analyser.frequencyBinCount
    this.dataArray = new Uint8Array(this.bufferLength)
    this.source.connect(this.analyser)
  }

  public calculateVolume = () => {
    this.analyser.getByteTimeDomainData(this.dataArray)
    let sum = 0
    for (let i = 0; i < this.bufferLength; i++) {
      const val = this.dataArray[i] - 128
      sum += val * val
    }
    const rms = Math.sqrt(sum / this.bufferLength)
    const normalized = rms / 127
    const perceptual = Math.log10(1 + 9 * normalized)
    const volumeValue = Math.round(perceptual * 100)
    return volumeValue
  }
}