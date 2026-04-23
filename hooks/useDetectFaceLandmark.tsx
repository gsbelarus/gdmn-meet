import { DrawingUtils, FaceLandmarker, FaceLandmarkerResult, FilesetResolver } from "@mediapipe/tasks-vision";
import { FRAME_MS } from "@/lib/constants";
import * as math from "mathjs";
import { RefObject, useEffect, useRef, useState } from "react";
import { TASK_VISION_WASM } from './task-vision-const';

interface Dot {
  x: number;
  y: number;
  z: number;
}

export const useDetectFaceLandmark = ({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null>; }) => {
  const [detector, setDetector] = useState<FaceLandmarker | null>(null);
  const animationTimeoutRef = useRef<NodeJS.Timeout | undefined>();
  const videoElementRef = useRef<HTMLVideoElement>(document.createElement("video"));
  videoElementRef.current.muted = true;

  const initializeDetector = async () => {
    if (detector) {
      return detector;
    }

    //FIXME: put the path in the constants
    const vision = await FilesetResolver.forVisionTasks(TASK_VISION_WASM);
    const faceLandmarkDetector = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1
    });

    setDetector(faceLandmarkDetector);
    return faceLandmarkDetector;
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

  async function startDetection(stream: MediaStream | null, isShowOnlyMask: boolean) {
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

    const { videoWidth, videoHeight } = video;

    if (videoWidth <= 0 || videoHeight <= 0) {
      return;
    }

    canvas.width = videoWidth;
    canvas.height = videoHeight;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }

    const drawingUtils = new DrawingUtils(ctx);

    let lastVideoTime = -1;
    let results: FaceLandmarkerResult | null = null;

    function detect() {
      if (!detector) {
        return;
      }

      if (!canvas || !ctx) {
        return;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!isShowOnlyMask) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const radio = video.videoHeight / video.videoWidth;
      video.style.width = videoWidth + "px";
      video.style.height = videoWidth * radio + "px";

      let startTimeMs = performance.now();
      if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = detector.detectForVideo(video, startTimeMs);
      }

      if (results?.faceLandmarks) {
        for (const landmarks of results.faceLandmarks) {
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#C0C0C070", lineWidth: 0.5 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#FF3030", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, { color: "#FF3030", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#C0FF30", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, { color: "#30FF30", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#E0E0E0", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#E0E0E0", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: "#FF3030", lineWidth: 1 });
          drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: "#30FF30", lineWidth: 1 });
        }

        if (results.faceLandmarks.length) {
          const parameters: Record<string, number> = {};

          const leftPupilInnerBoundHozontal: number[] = Object.values(results.faceLandmarks[0][469]); // Внутренняя точка левого зрачка
          const leftPupilOuterBoundHozontal: number[] = Object.values(results.faceLandmarks[0][471]); // Внешняя точка левого зрачка
          const leftPupilUpBoundVertical: number[] = Object.values(results.faceLandmarks[0][470]); // Внутренняя точка левого зрачка
          const leftPupilBottomBoundVertical: number[] = Object.values(results.faceLandmarks[0][472]); // Внешняя точка левого зрачка
          const rightPupilInnerBoundHozontal: number[] = Object.values(results.faceLandmarks[0][476]); // Внутренняя точка правого зрачка
          const rightPupilOuterBoundHozontal: number[] = Object.values(results.faceLandmarks[0][474]); // Внешняя точка правого зрачка
          const rightPupilUpBoundVertical: number[] = Object.values(results.faceLandmarks[0][475]); // Внутренняя точка правого зрачка
          const rightPupilBottomBoundVertical: number[] = Object.values(results.faceLandmarks[0][477]); // Внешняя точка правого зрачка

          parameters["leftPupilDiameterHorizontal"] = math.norm(math.subtract(leftPupilInnerBoundHozontal, leftPupilOuterBoundHozontal)) as number; // + math.norm(math.subtract(leftEyeUpBoundVertical,leftEyeBottomBoundVertical))) / 2;
          parameters["leftPupilDiameterVertical"] = math.norm(math.subtract(leftPupilUpBoundVertical, leftPupilBottomBoundVertical)) as number;
          parameters["rightPupilDiameterHorizontal"] = math.norm(math.subtract(rightPupilInnerBoundHozontal, rightPupilOuterBoundHozontal)) as number; // + math.norm(math.subtract(rightEyeUpBoundVertical,rightEyeBottomBoundVertical))) / 2;
          parameters["rightPupilDiameterVertical"] = math.norm(math.subtract(rightPupilUpBoundVertical, rightPupilBottomBoundVertical)) as number;

          const noseTip: number[] = Object.values(results.faceLandmarks[0][1]) as number[]; // Кончик носа

          const leftEyeInnerCorner: number[] = Object.values(results.faceLandmarks[0][173]); // Внутренний угол левого глаза
          const leftEyeOuterCorner: number[] = Object.values(results.faceLandmarks[0][33]); // Внешний угол левого глаза
          const leftPupil: number[] = Object.values(results.faceLandmarks[0][468]); // Левый зрачок

          const rightEyeInnerCorner: number[] = Object.values(results.faceLandmarks[0][398]); // Внутренний угол правого глаза
          const rightEyeOuterCorner: number[] = Object.values(results.faceLandmarks[0][263]); // Внешний угол правого глаза
          const rightPupil: number[] = Object.values(results.faceLandmarks[0][473]); // Правый зрачок

          const leftEar: number[] = Object.values(results.faceLandmarks[0][234]); // Левое ухо
          const rightEar: number[] = Object.values(results.faceLandmarks[0][454]);  // Правое ухо

          // horizontal angle
          const horizontalAngle = horizontalAngleFunction(noseTip, leftEar, rightEar);
          parameters["horizontalAngle"] = horizontalAngle / 100;

          // vertical angle
          const verticalAngle = verticalAngleFunction(noseTip, leftEar, rightEar);
          parameters["verticalAngle"] = verticalAngle / 100;

          // left eye
          const pupilOffsetLeft = pupilOffsetHorizontal(
            leftEyeInnerCorner,
            leftEyeOuterCorner,
            leftPupil,
            'left'
          );
          parameters["pupilOffsetLeft"] = pupilOffsetLeft;

          // right eye
          const pupilOffsetRight = pupilOffsetHorizontal(
            rightEyeInnerCorner,
            rightEyeOuterCorner,
            rightPupil,
            'right'
          );
          parameters["pupilOffsetRight"] = pupilOffsetRight;

          // distance
          parameters["earVectorDistance"] = earVectorDistance(
            leftEar,
            rightEar
          ) as number;
          parameters["pupilOffsetHorizontal"] = pupilOffsetHorizontal3(leftPupilInnerBoundHozontal, leftPupilOuterBoundHozontal, leftEyeInnerCorner, leftEyeOuterCorner);

          // Gaze direction tracking
          const verticalCoef = 75;
          const verticalHeadRotation = ((verticalAngle / verticalCoef / parameters["earVectorDistance"]));
          let circleY = video.videoHeight / 2 * (1 - verticalHeadRotation);

          const horizontalCoef = 75;
          const pupilsCoef = 2; //1.5 * 1.5;
          const horizontalHeadRotation = ((horizontalAngle / horizontalCoef / parameters["earVectorDistance"]));
          let circleX = video.videoWidth / 2 * (1 + horizontalHeadRotation);

          drawFocus(ctx, circleX, circleY, 'green'); // draw headFocus

          let horizontalPupilRotation = pupilsCoef / parameters["earVectorDistance"];
          if (horizontalAngle > 30) {
            horizontalPupilRotation = horizontalPupilRotation * parameters["pupilOffsetLeft"];
          } else {
            if (horizontalAngle < -30) {
              horizontalPupilRotation = horizontalPupilRotation * parameters["pupilOffsetRight"];
            } else {
              horizontalPupilRotation = horizontalPupilRotation * (parameters["pupilOffsetRight"] - parameters["pupilOffsetLeft"]);
            }
          }

          circleX = video.videoWidth / 2 * (1 + horizontalPupilRotation);
          circleX = video.videoWidth / 2 * (1 + horizontalHeadRotation + horizontalPupilRotation);

          // draw face parameters
          parameters["pupilOffsetHorizontal"] = parameters["pupilOffsetHorizontal"] / 100;
        }
      }

      animationTimeoutRef.current = setTimeout(detect, FRAME_MS);
    }

    detect();

    // Создаем новый видеотрек с измененным фоном
    const processedStream = canvas.captureStream();
    const newVideoTrack = processedStream.getVideoTracks()[0];

    // Заменяем существующий видеотрек на новый
    stream.removeTrack(newStream.getVideoTracks()[0]);
    stream.addTrack(newVideoTrack);
  }

  function drawFocus(context: any, centerX: number, centerY: number, color: string, radius = 10) {
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, 2 * math.pi, false);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = '#003300';
    context.stroke();
  }

  function pupilOffsetHorizontal(eyeInnerCorner: number[], eyeOuterCorner: number[], pupil: number[], LR: string) {
    // Вектор от внутреннего угла глаза к зрачку
    const eyeInnerCornerToPupilVector = math.subtract(pupil, eyeInnerCorner);

    // Вектор от внешнего угла глаза к зрачку
    const eyeOuterCornerToPupilVector = math.subtract(pupil, eyeOuterCorner);

    // Найдем расстояние между внутренним углом глаза и зрачком
    let eyeInnerCornerToPupilVectorLength = math.norm(eyeInnerCornerToPupilVector) as number; //.slice(0, 2)); //игнорируем координату z

    // Найдем расстояние между внешним углом глаза и зрачком
    const eyeOuterCornerToPupilVectorLength = math.norm(eyeOuterCornerToPupilVector) as number; //.slice(0, 2)); //игнорируем координату z

    const coef = 1; //0.8;
    eyeInnerCornerToPupilVectorLength = eyeInnerCornerToPupilVectorLength / coef;

    // Найдем относительное смещение зрачка
    const pupilOffset = eyeInnerCornerToPupilVectorLength /
      (eyeInnerCornerToPupilVectorLength + eyeOuterCornerToPupilVectorLength) - 0.5;

    return pupilOffset;
  }

  function earVectorDistance(leftEar: number[], rightEar: number[]) {
    // Вектор от левого уха к правому
    const earVector = math.subtract(leftEar, rightEar);

    // Найдем расстояние между левым и правым ухом
    const earVectorLength = math.norm(earVector);

    return earVectorLength;
  }

  function horizontalAngleFunction(noseTip: number[], leftEar: number[], rightEar: number[]) {
    // Центр головы как среднее между ушами
    const headCenter: number[] = [(leftEar[0] + rightEar[0]) / 2, (leftEar[1] + rightEar[1]) / 2, (leftEar[2] + rightEar[2]) / 2];

    // Вектор от центра головы к кончику носа
    const noseVector: number[] = math.subtract(noseTip.slice(0, headCenter.length), headCenter) as number[];

    return math.sign(noseVector[0]) * toDegrees(math.asin(math.abs(noseVector[0]) / (math.sqrt(noseVector[0] * noseVector[0] + noseVector[2] * noseVector[2]) as number)));
  }

  function verticalAngleFunction(noseTip: number[], leftEar: number[], rightEar: number[]) {
    // Центр головы как среднее между ушами
    const headCenter: number[] = [(leftEar[0] + rightEar[0]) / 2, (leftEar[1] + rightEar[1]) / 2, (leftEar[2] + rightEar[2]) / 2];

    // Вектор от центра головы к кончику носа
    const noseVector: number[] = math.subtract(noseTip.slice(0, headCenter.length), headCenter) as number[];

    return - math.sign(noseVector[1]) * toDegrees(math.asin(math.abs(noseVector[1]) / (math.sqrt(noseVector[1] * noseVector[1] + noseVector[2] * noseVector[2]) as number)));
  }

  function toDegrees(angle: any) {
    return angle * (180 / Math.PI);
  }


  function pupilOffsetHorizontal3(
    pupilInnerBound: number[],
    pupilOuterBound: number[],
    eyeInnerCorner: number[],
    eyeOuterCorner: number[]
  ) {
    let dot = (p1: Dot, p2: Dot) => p1.x * p2.x + p1.y * p2.y + p1.z * p2.z;
    let magSq = ({ x, y, z }: Dot) => x ** 2 + y ** 2 + z ** 2;

    // Вектор от внутреннего угла глаза к внешнему (линия оси глаза)
    const eyeAxis = math.subtract(eyeOuterCorner, eyeInnerCorner);

    // Центр оси глаза (середина между внутренним и внешним углами)
    const eyeCenter = [(eyeInnerCorner[0] + eyeOuterCorner[0]) / 2, (eyeInnerCorner[1] + eyeOuterCorner[1]) / 2, (eyeInnerCorner[2] + eyeOuterCorner[2]) / 2];

    // Вектор от внутреннего угла глаза к внешнему (линия оси глаза)
    const pupilAxis = math.subtract(pupilOuterBound, pupilInnerBound);

    // Смещенный вектор от внутреннего угла глаза к внешнему (линия оси глаза)
    const pupilAxisOffset = math.subtract(pupilAxis, eyeAxis);

    let a = { x: pupilAxisOffset[0], y: pupilAxisOffset[1], z: pupilAxisOffset[2] };
    let b = { x: pupilAxis[0], y: pupilAxis[1], z: pupilAxis[2] };

    let angle1 = Math.acos(dot(a, b) / Math.sqrt(magSq(a) * magSq(b))) * (180 / Math.PI) - 180;
    return angle1;
  }

  return { startDetection, stopDetection };
};
