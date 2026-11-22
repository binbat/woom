import {
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision'

// import mediapipe wasm files as url https://vite.dev/guide/assets#explicit-url-imports
import wasmLoaderPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'

import modelAssetPath from '@/assets/models/selfie_multiclass_256x256.tflite?url'
import {
  getVirtualBackground,
  type VirtualBackgroundId,
} from '../../lib/background'
import { log } from '../../lib/log'

const wasmFileset = {
  wasmLoaderPath,
  wasmBinaryPath,
}

const START_TIMEOUT = 20_000

type Delegate = 'GPU' | 'CPU'

export class VirtualBackgroundStream {
  private webcamRunning = false
  private segmenter: ImageSegmenter | null = null
  private backgroundId: VirtualBackgroundId
  private backgroundImage: HTMLImageElement | null = null
  private backgroundRequest = 0
  private lifecycle = 0
  private videoWidth = 640
  private videoHeight = 480

  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private canvasCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private maskCanvas: HTMLCanvasElement
  private maskCtx: CanvasRenderingContext2D
  private frameTimer: number | undefined
  private outputStream: MediaStream | null = null
  private cameraTrack: MediaStreamTrack | null = null
  private onError: (error: Error) => void

  constructor(
    backgroundId: VirtualBackgroundId,
    onError: (error: Error) => void
  ) {
    this.backgroundId = backgroundId
    this.onError = onError
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true

    this.canvas = document.createElement('canvas')
    this.canvas.width = this.videoWidth
    this.canvas.height = this.videoHeight
    const canvasCtx = this.canvas.getContext('2d')
    if (!canvasCtx) throw new Error('Canvas 2D context is not available')
    this.canvasCtx = canvasCtx

    this.tempCanvas = document.createElement('canvas')
    this.tempCanvas.width = this.videoWidth
    this.tempCanvas.height = this.videoHeight
    const tempCtx = this.tempCanvas.getContext('2d')
    if (!tempCtx)
      throw new Error('Temporary canvas 2D context is not available')
    this.tempCtx = tempCtx

    this.maskCanvas = document.createElement('canvas')
    const maskCtx = this.maskCanvas.getContext('2d')
    if (!maskCtx) throw new Error('Mask canvas 2D context is not available')
    this.maskCtx = maskCtx
  }

  async setBackground(id: VirtualBackgroundId) {
    const request = ++this.backgroundRequest
    const image = new Image()
    image.src = getVirtualBackground(id).url
    try {
      await image.decode()
    } catch (error) {
      log('error', 'virtual_background_load_failed', String(error), {
        backgroundId: id,
      })
      throw new Error('Unable to load virtual background', { cause: error })
    }
    if (request !== this.backgroundRequest) return
    this.backgroundId = id
    this.backgroundImage = image
  }

  private isActive(request: number) {
    return request === this.lifecycle
  }

  private async createImageSegmenter(request: number, delegate: Delegate) {
    const startedAt = performance.now()
    try {
      const segmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate,
        },
        outputCategoryMask: true,
        runningMode: 'VIDEO',
      })
      if (!this.isActive(request)) {
        segmenter.close()
        return
      }
      this.segmenter = segmenter
      log('info', 'virtual_background_initialized', '', {
        delegate,
        durationMs: Math.round(performance.now() - startedAt),
      })
    } catch (error) {
      log('warn', 'image_segmenter_init_failed', String(error), { delegate })
      throw error
    }
  }

  private async initializeSegmenter(request: number) {
    try {
      await this.createImageSegmenter(request, 'GPU')
    } catch {
      if (!this.isActive(request)) return
      try {
        await this.createImageSegmenter(request, 'CPU')
      } catch (cpuError) {
        throw new Error('Virtual background is not available on this device', {
          cause: cpuError,
        })
      }
    }
  }

  private setSourceDimensions(track: MediaStreamTrack) {
    const { width, height } = track.getSettings()
    if (width && height && width < height) {
      this.videoWidth = 480
      this.videoHeight = 640
    }
    this.canvas.width = this.videoWidth
    this.canvas.height = this.videoHeight
    this.tempCanvas.width = this.videoWidth
    this.tempCanvas.height = this.videoHeight
  }

  private async openStream(sourceTrack: MediaStreamTrack, request: number) {
    await Promise.all([
      this.setBackground(this.backgroundId),
      this.initializeSegmenter(request),
    ])
    if (!this.isActive(request) || sourceTrack.readyState !== 'live') {
      throw new Error('Virtual background startup was cancelled')
    }

    this.setSourceDimensions(sourceTrack)
    this.cameraTrack = sourceTrack.clone()
    this.video.srcObject = new MediaStream([this.cameraTrack])
    await this.video.play()
    if (!this.isActive(request)) {
      throw new Error('Virtual background startup was cancelled')
    }

    this.webcamRunning = true
    this.outputStream = this.canvas.captureStream(15)
    this.predictWebcam()
    return this.outputStream
  }

  public createCameraStream() {
    if (this.cameraTrack?.readyState !== 'live') {
      throw new Error('The camera is no longer available')
    }
    return new MediaStream([this.cameraTrack.clone()])
  }

  private callbackForVideo = (segmentationResult: ImageSegmenterResult) => {
    const mask = segmentationResult.categoryMask
    if (!mask || !this.webcamRunning) {
      mask?.close()
      return
    }
    try {
      const maskData = mask.hasUint8Array()
        ? mask.getAsUint8Array()
        : mask.getAsFloat32Array()
      const imageData = new ImageData(mask.width, mask.height)
      for (let i = 0; i < maskData.length; i++) {
        imageData.data[i * 4 + 3] = maskData[i] === 0 ? 0 : 255
      }
      if (
        this.maskCanvas.width !== mask.width ||
        this.maskCanvas.height !== mask.height
      ) {
        this.maskCanvas.width = mask.width
        this.maskCanvas.height = mask.height
      }
      this.maskCtx.putImageData(imageData, 0, 0)

      this.tempCtx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.tempCtx.drawImage(
        this.video,
        0,
        0,
        this.video.videoWidth,
        this.video.videoHeight
      )
      this.tempCtx.save()
      this.tempCtx.globalCompositeOperation = 'destination-in'
      this.tempCtx.filter = 'blur(1px)'
      this.tempCtx.drawImage(
        this.maskCanvas,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      )
      this.tempCtx.restore()

      this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
      if (this.backgroundImage) {
        const image = this.backgroundImage
        const scale = Math.max(
          this.canvas.width / image.naturalWidth,
          this.canvas.height / image.naturalHeight
        )
        const sourceWidth = this.canvas.width / scale
        const sourceHeight = this.canvas.height / scale
        this.canvasCtx.drawImage(
          image,
          (image.naturalWidth - sourceWidth) / 2,
          (image.naturalHeight - sourceHeight) / 2,
          sourceWidth,
          sourceHeight,
          0,
          0,
          this.canvas.width,
          this.canvas.height
        )
      }
      this.canvasCtx.drawImage(this.tempCanvas, 0, 0)
    } finally {
      mask.close()
    }
  }

  private predictWebcam = () => {
    this.frameTimer = undefined
    if (!this.segmenter || !this.webcamRunning) return
    try {
      const result = this.segmenter.segmentForVideo(
        this.video,
        performance.now()
      )
      try {
        this.callbackForVideo(result)
      } finally {
        result.confidenceMasks?.forEach(mask => {
          mask.close()
        })
      }
    } catch (error) {
      log('error', 'virtual_background_frame_failed', String(error))
      this.destroyStream()
      this.onError(
        new Error('Virtual background processing failed', { cause: error })
      )
    } finally {
      if (this.webcamRunning) {
        this.frameTimer = window.setTimeout(this.predictWebcam, 1000 / 15)
      }
    }
  }

  public async startStream(
    sourceTrack: MediaStreamTrack
  ): Promise<MediaStream> {
    if (sourceTrack.readyState !== 'live') {
      throw new Error('No camera available for virtual background')
    }
    const request = this.lifecycle
    const startedAt = performance.now()
    let timer: number | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => {
        this.destroyStream()
        reject(
          new Error('Virtual background startup timed out. Please try again.')
        )
      }, START_TIMEOUT)
    })
    log('info', 'virtual_background_start', '')
    try {
      const stream = await Promise.race([
        this.openStream(sourceTrack, request),
        timeout,
      ])
      log('info', 'virtual_background_started', '', {
        durationMs: Math.round(performance.now() - startedAt),
      })
      return stream
    } catch (error) {
      log('error', 'virtual_background_start_failed', String(error), {
        durationMs: Math.round(performance.now() - startedAt),
      })
      throw error
    } finally {
      window.clearTimeout(timer)
    }
  }

  public destroyStream = () => {
    this.lifecycle++
    this.webcamRunning = false
    this.backgroundRequest++
    window.clearTimeout(this.frameTimer)
    this.frameTimer = undefined
    this.segmenter?.close()
    this.segmenter = null
    this.backgroundImage = null
    this.outputStream?.getTracks().forEach(track => {
      track.stop()
    })
    this.outputStream = null
    this.cameraTrack?.stop()
    this.cameraTrack = null
    this.video.pause()
    this.video.srcObject = null
    this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
    this.tempCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
  }
}
