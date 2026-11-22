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

export class VirtualBackgroundStream {
  private deviceId: string
  private webcamRunning: boolean
  private segmenter: ImageSegmenter | null
  private backgroundId: VirtualBackgroundId
  private backgroundImage: HTMLImageElement | null = null
  private backgroundRequest = 0
  private videoWidth: number
  private videoHeight: number

  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private canvasCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private maskCanvas: HTMLCanvasElement
  private maskCtx: CanvasRenderingContext2D
  private frameTimer: number | undefined

  constructor(deviceId: string, backgroundId: VirtualBackgroundId) {
    this.deviceId = deviceId
    this.backgroundId = backgroundId
    this.webcamRunning = false
    this.segmenter = null
    if (window.matchMedia('(orientation: portrait)').matches) {
      this.videoWidth = 480
      this.videoHeight = 640
    } else {
      this.videoWidth = 640
      this.videoHeight = 480
    }

    this.video = document.createElement('video')

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

  private async createImageSegmenter() {
    try {
      this.segmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
        outputCategoryMask: true,
        runningMode: 'VIDEO',
      })
    } catch (error) {
      log('error', 'image_segmenter_init_failed', String(error))
      throw new Error('Virtual background is not available on this device', {
        cause: error,
      })
    }
  }

  private callbackForVideo = (segmentationResult: ImageSegmenterResult) => {
    const mask = segmentationResult.categoryMask
    if (!mask || !this.webcamRunning) {
      mask?.close()
      return
    }
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
    mask.close()

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

    // put two layers together
    this.canvasCtx.drawImage(this.tempCanvas, 0, 0)
  }

  private predictWebcam = () => {
    this.frameTimer = undefined
    if (!this.segmenter || !this.webcamRunning) return
    try {
      this.segmenter.segmentForVideo(
        this.video,
        performance.now(),
        this.callbackForVideo
      )
    } catch (error) {
      this.webcamRunning = false
      log('error', 'virtual_background_frame_failed', String(error))
    } finally {
      if (this.webcamRunning) {
        this.frameTimer = window.setTimeout(this.predictWebcam, 1000 / 15)
      }
    }
  }

  public async startStream(): Promise<MediaStream> {
    await this.setBackground(this.backgroundId)
    try {
      if (!this.segmenter) {
        await this.createImageSegmenter()
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: this.deviceId,
        },
      })
      return await new Promise<MediaStream>((resolve, reject) => {
        this.video.srcObject = stream
        this.video.onloadeddata = async () => {
          try {
            await this.video.play()
            this.webcamRunning = true
            this.predictWebcam()
            resolve(this.canvas.captureStream())
          } catch (error) {
            stream.getTracks().forEach(track => {
              track.stop()
            })
            reject(error)
          }
        }
      })
    } catch (error) {
      log('error', 'virtual_background_start_failed', String(error))
      return new MediaStream()
    }
  }

  public destroyStream = () => {
    this.webcamRunning = false
    this.backgroundRequest++
    window.clearTimeout(this.frameTimer)
    this.frameTimer = undefined
    this.segmenter?.close()
    this.segmenter = null
    this.backgroundImage = null
    const stream = this.video.srcObject as MediaStream | null
    stream?.getTracks().forEach(track => {
      track.stop()
    })
    this.video.pause()
    this.video.srcObject = null
    this.video.onloadeddata = null
    this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
    this.tempCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
  }
}
