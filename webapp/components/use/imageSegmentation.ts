import { ImageSegmenter, FilesetResolver, ImageSegmenterResult } from '@mediapipe/tasks-vision'
import imgUrl from '@/webapp/background.jpg'

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
    this.backgroundImage.src = imgUrl
    this.videoWidth = 480
    this.videoHeight = 360

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
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      )
  
      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/selfie_multiclass_256x256.tflite',
          delegate: "GPU"
        },
        outputCategoryMask: true,
        runningMode: "VIDEO"
      })
    } catch (error) {
      console.error("failed to create a segmenter:", error)
    }
  }

  private callbackForVideo = (segmentationResult: ImageSegmenterResult) => {
    if (!segmentationResult || !segmentationResult.categoryMask) return
    const imageData = this.tempCtx.getImageData(0, 0, this.videoWidth, this.videoHeight).data
    // get results of segmentation
    // 0 - background
    // 1 - hair
    // 2 - body-skin
    // 3 - face-skin
    // 4 - clothes
    // 5 - others (accessories)
    const maskData = segmentationResult.categoryMask.getAsUint8Array()
  
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
      this.canvasCtx.drawImage(this.backgroundImage, 0, 0, this.videoWidth, this.videoHeight)
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
       // 在临时画布上绘制视频帧
      this.tempCtx.drawImage(this.video, 0, 0, this.videoWidth, this.videoHeight)
      this.segmenter.segmentForVideo(this.video, performance.now(), this.callbackForVideo)
    } catch (error) {
      console.error("处理视频帧时出错:", error)
    }
  }

  public async startStream(): Promise<MediaStream> {
    try {
      if (!this.segmenter) {
        await this.createImageSegmenter()
      }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 480, height: 360, deviceId: this.deviceId } })
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
      console.error("failed to activate webcam:", error)
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

