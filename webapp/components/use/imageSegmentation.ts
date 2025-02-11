import { ImageSegmenter, FilesetResolver, ImageSegmenterResult } from '@mediapipe/tasks-vision'

let imageSegmenter: ImageSegmenter
let webcamRunning: boolean = false
let streamForVirtualBackground: MediaStream | null = null

const videoWidth = 480
const videoHeight = 360

// 创建背景图片元素
const backgroundImage = new Image()
backgroundImage.src = './background.jpg'

// 初始化视频元素
const video = document.createElement('video')
const canvas = document.createElement('canvas')
const canvasCtx = canvas.getContext('2d')!

// 设置画布尺寸
canvas.width = videoWidth
canvas.height = videoHeight

// 创建临时画布用于处理视频帧
const tempCanvas = document.createElement('canvas')
tempCanvas.width = videoWidth
tempCanvas.height = videoHeight
const tempCtx = tempCanvas.getContext('2d')!

// 创建 ImageSegmenter
async function createImageSegmenter() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    )

    imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
        delegate: "GPU"
      },
      outputCategoryMask: true,
      runningMode: "VIDEO"
    })
    console.log("创建分割器成功")
  } catch (error) {
    console.error("创建分割器失败:", error)
  }
}

function callbackForVideo(segmentationResult: ImageSegmenterResult) {
  if (!segmentationResult || !segmentationResult.categoryMask) return
  const imageData = tempCtx.getImageData(0, 0, videoWidth, videoHeight).data
  // 获取分割结果
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
    // 将特定类的像素点设置为透明
    if (maskVal == 0) { 
      imageData[j + 3] = 0 // A - 透明
    }
  }

  // 清空主画布
  canvasCtx.clearRect(0, 0, videoWidth, videoHeight)
  
  // 绘制背景图片
  if (backgroundImage.complete && backgroundImage.naturalHeight !== 0) {
    canvasCtx.drawImage(backgroundImage, 0, 0, videoWidth, videoHeight)
  }

  const uint8Array = new Uint8ClampedArray(imageData.buffer)
  const dataNew = new ImageData(
    uint8Array,
    video.videoWidth,
    video.videoHeight
  )

  // 将处理后的视频帧绘制到主画布上
  tempCtx.putImageData(dataNew, 0, 0)
  canvasCtx.drawImage(tempCanvas, 0, 0)
  
  // 释放资源
  // segmentationResult.close();

  window.requestAnimationFrame(predictWebcam)
}

// 处理视频帧
async function predictWebcam() {
  if (!imageSegmenter || !webcamRunning) return
  try {
     // 在临时画布上绘制视频帧
    tempCtx.drawImage(video, 0, 0, videoWidth, videoHeight)
    imageSegmenter.segmentForVideo(video, performance.now(), callbackForVideo)
  } catch (error) {
    console.error("处理视频帧时出错:", error)
  }
}

async function enableSegmentation(deviceId: string) {
  try {
    if (!imageSegmenter) {
      await createImageSegmenter()
    }
      // 开始图像分割
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 480, height: 360, deviceId: deviceId } })
      video.srcObject = stream
      video.onloadeddata = async () => {
        video.play()
        webcamRunning = true
        await predictWebcam()
        streamForVirtualBackground = canvas.captureStream()
      }
  } catch (error) {
    console.error("启动摄像头失败:", error);
  }
}

async function disableSegmentation() {
  if (streamForVirtualBackground === null) return
  webcamRunning = false
  const stream = video.srcObject as MediaStream
  const tracks = stream.getTracks()
  tracks.forEach(track => track.stop())
  video.srcObject = null
  canvasCtx.clearRect(0, 0, videoWidth, videoHeight)
  streamForVirtualBackground = null
}

async function asyncGetStreamForVirtualBackground(deviceId: string): Promise<MediaStream> {
  await enableSegmentation(deviceId)
  while (streamForVirtualBackground === null) {
    await new Promise(resolve => setTimeout(resolve, 100)) // 每100ms检查一次
  }
  return streamForVirtualBackground
}

export {
  asyncGetStreamForVirtualBackground,
  disableSegmentation,
}
