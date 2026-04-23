
import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { FRAME_MS } from "@/lib/constants";
import { RefObject, useEffect, useRef, useState } from "react";
import { TASK_VISION_WASM } from './task-vision-const';

export const useDetectObjects = ({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null>; }) => {

  const [detector, setDetector] = useState<ObjectDetector | null>(null);

  const animationTimeoutRef = useRef<NodeJS.Timeout | undefined>();
  const videoElementRef = useRef<HTMLVideoElement>(document.createElement("video"));
  videoElementRef.current.muted = true;

  const initializeDetector = async () => {
    if (detector) {
      return detector;
    }

    const vision = await FilesetResolver.forVisionTasks(TASK_VISION_WASM);
    const objectsDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
        delegate: "GPU"
      },
      scoreThreshold: 0.5,
      runningMode: "IMAGE"
    });

    setDetector(objectsDetector);
    return objectsDetector;
  };

  useEffect(() => {
    return () => {
      clearTimeout(animationTimeoutRef.current);
    };
  }, []);

  const stopDetection = () => {
    if (!detector) {
      return;
    }

    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = undefined;
    }

    if (!videoElementRef.current.srcObject) {
      return;
    }

    const videoTracks = (videoElementRef.current.srcObject as MediaStream).getVideoTracks();
    videoTracks.forEach((track) => track.stop());
    videoElementRef.current.srcObject = null;
  };

  async function setupCamera(stream: MediaStream): Promise<HTMLVideoElement> {
    const video = videoElementRef.current;
    video.srcObject = stream;

    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        resolve(video);
      };
    });
  }

  async function startDetection(stream: MediaStream | null) {
    if (!stream) {
      return;
    }

    const detector = await initializeDetector();
    const newStream = new MediaStream(stream);
    const video = await setupCamera(newStream);
    await video.play();

    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    function detect() {
      if (!detector) {
        return;
      }

      if (!canvas || !ctx) {
        return;
      }

      ctx.save();

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const results = detector.detect(video);
      results.detections.forEach(detection => {
        const boundingBoxWidth = detection.boundingBox?.width ?? 0;
        const boundingBoxHeight = detection.boundingBox?.height ?? 0;
        const boundingBoxOriginX = detection.boundingBox?.originX ?? 0;
        const boundingBoxOriginY = detection.boundingBox?.originY ?? 0;

        ctx.beginPath();
        ctx.rect(boundingBoxOriginX, boundingBoxOriginY, boundingBoxWidth, boundingBoxHeight);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'lime';
        ctx.stroke();

        const headerText =
          `${detection.categories[0].categoryName} ${Math.round(detection.categories[0].score * 100)}%`;
        ctx.fillStyle = 'white';
        ctx.font = "medium 12px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(headerText, boundingBoxOriginX + boundingBoxWidth - 8, boundingBoxOriginY + 8);
      });

      // ctx.restore();

      //TODO: check if we can lower the frame rate here
      animationTimeoutRef.current = setTimeout(detect, FRAME_MS);
    }

    detect();

    // Создаем новый видеотрек с измененным фоном
    const processedStream = canvas.captureStream();
    console.log('processedStream ', processedStream);
    const newVideoTrack = processedStream.getVideoTracks()[0];
    console.log('newVideoTrack ', newVideoTrack);

    // Заменяем существующий видеотрек на новый
    stream.removeTrack(newStream.getVideoTracks()[0]);
    stream.addTrack(newVideoTrack);
  }

  return { startDetection, stopDetection };
};
