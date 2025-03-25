import { ImageSegmenter, type ImageSegmenterResult } from '@mediapipe/tasks-vision'

// import mediapipe wasm files as url https://vite.dev/guide/assets#explicit-url-imports
import wasmLoaderPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'

import backgroundImgSrc from '@/assets/background.jpg?url'
import modelAssetPath from '@/assets/models/selfie_multiclass_256x256.tflite?url'

const wasmFileset = {
  wasmLoaderPath,
  wasmBinaryPath
}

export class VirtualBackgroundStream {
  private deviceId: string
  private webcamRunning: boolean
  private segmenter: ImageSegmenter | null
  private backgroundImage: HTMLImageElement
  private videoWidth: number
  private videoHeight: number

  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private canvasCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D

  constructor(deviceId: string) {
    this.deviceId = deviceId
    this.webcamRunning = false
    this.segmenter = null
    this.backgroundImage = new Image()
    this.backgroundImage.src = backgroundImgSrc
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
    this.canvasCtx = this.canvas.getContext('2d')!

    this.tempCanvas = document.createElement('canvas')
    this.tempCanvas.width = this.videoWidth
    this.tempCanvas.height = this.videoHeight
    this.tempCtx = this.tempCanvas.getContext('2d')!
  }

  private async createImageSegmenter() {
    try {
      this.segmenter = await ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU'
        },
        outputCategoryMask: true,
        runningMode: 'VIDEO'
      })
    } catch (error) {
      console.error('failed to create a segmenter:', error)
    }
  }

  private callbackForVideo = (segmentationResult: ImageSegmenterResult) => {
    if (!segmentationResult || !segmentationResult.categoryMask) return
    const imageData = this.tempCtx.getImageData(0, 0, this.video.videoWidth, this.video.videoHeight).data
    // get results of segmentation
    // 0 - background
    // 1 - hair
    // 2 - body-skin
    // 3 - face-skin
    // 4 - clothes
    // 5 - others (accessories)
    const maskData = segmentationResult.categoryMask.getAsFloat32Array()

    for (let i = 0; i < maskData.length; ++i) {
      const maskVal = maskData[i]
      const j = i * 4
      // set chosen pixels to transparent
      if (maskVal == 0) {
        imageData[j + 3] = 0 // alpha channel
      }
    }

    this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)

    // draw background image
    if (this.backgroundImage.complete && this.backgroundImage.naturalHeight !== 0) {
      this.canvasCtx.drawImage(this.backgroundImage, 0, 0, this.video.videoWidth, this.video.videoHeight)
    }

    const uint8Array = new Uint8ClampedArray(imageData.buffer)
    const dataNew = new ImageData(
      uint8Array,
      this.video.videoWidth,
      this.video.videoHeight
    )

    // put segmented frame onto canvas
    this.tempCtx.putImageData(dataNew, 0, 0)
    this.canvasCtx.drawImage(this.tempCanvas, 0, 0)

    window.requestAnimationFrame(this.predictWebcam)
  }

  private predictWebcam = () => {
    if (!this.segmenter || !this.webcamRunning) return
    try {
      // draw video frame on tempCanvas
      this.tempCtx.drawImage(this.video, 0, 0, this.video.videoWidth, this.video.videoHeight)
      this.segmenter.segmentForVideo(this.video, performance.now(), this.callbackForVideo)
    } catch (error) {
      console.error('error when processing frame:', error)
    }
  }

  public async startStream(): Promise<MediaStream> {
    try {
      if (!this.segmenter) {
        await this.createImageSegmenter()
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: this.deviceId
        }
      })
      return new Promise(resolve => {
        this.video.srcObject = stream
        this.video.onloadeddata = async () => {
          this.video.play()
          this.webcamRunning = true
          this.predictWebcam()
          resolve(this.canvas.captureStream())
        }
      })
    } catch (error) {
      console.error('failed to activate webcam:', error)
      return new Promise(resolve => resolve(new MediaStream()))
    }
  }

  public destroyStream = () => {
    const stream = this.video.srcObject as MediaStream
    if (stream === null) return
    this.webcamRunning = false
    const tracks = stream.getTracks()
    tracks.forEach(track => track.stop())
    this.video.srcObject = null
    this.canvasCtx.clearRect(0, 0, this.videoWidth, this.videoHeight)
  }
}
