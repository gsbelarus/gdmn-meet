"use client";
import { useCallback, useEffect } from "react";
import { BgEffectType, Props } from './index.type';

import {
  ResultsListener,
  SelfieSegmentation,
} from "@mediapipe/selfie_segmentation";
import { FRAME_MS, VIDEO_HEIGHT_MAX, VIDEO_WIDTH_MAX } from "@/lib/constants";
import { useRef, useState } from "react";

export const useBackgroundRemoval = ({ canvasRef, onApplyBackground }: Props) => {
  const [error, setError] = useState<string>();

  const animationTimeoutRef = useRef<NodeJS.Timeout | undefined>();
  const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  const selfieSegmentationRef = useRef<SelfieSegmentation | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      clearTimeout(animationTimeoutRef.current);
    };
  }, []);

  const isBrowserSupported = () => {
    const userAgent = navigator.userAgent;

    return (
      (/Chrome/.test(userAgent) && /Google Inc/.test(navigator.vendor)) ||
      /Firefox/.test(userAgent)
    );
  };

  const isWebAssemblySupported = () => {
    return typeof WebAssembly === "object";
  };

  const isWebGLSupported = () => {
    const canvas = document.createElement("canvas");

    let isSupported = true;

    try {
      isSupported = !!(
        WebGLRenderingContext &&
        (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
      );
    } catch (e) {
      isSupported = false;
    } finally {
      canvas.remove();
    }

    return isSupported;
  };

  const clearBackgroundRemoval = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = undefined;
    }

    if (selfieSegmentationRef.current) {
      selfieSegmentationRef.current.close();
      selfieSegmentationRef.current = null;
    }

    if (videoElementRef.current?.srcObject) {
      const videoTracks = (videoElementRef.current.srcObject as MediaStream).getVideoTracks();
      videoTracks.forEach((track) => track.stop());
      videoElementRef.current.srcObject = null;
    }

    if (originalVideoTrackRef.current) {
      originalVideoTrackRef.current.stop();
      originalVideoTrackRef.current = null;
    }

    onApplyBackground(false);
  }, [onApplyBackground]);

  const applyBackgroundRemoval = useCallback(async (inputStream: MediaStream, effect: BgEffectType = 'blur') => {
    clearBackgroundRemoval();

    const canvas = canvasRef.current;
    if (!canvas) {
      setError("canvasRef is required");
      onApplyBackground(false);
      return inputStream;
    }

    if (!isBrowserSupported()) {
      setError("Browser is not supported");
      onApplyBackground(false);
      return inputStream;
    }

    if (!isWebAssemblySupported()) {
      setError("WebAssembly is not supported");
      onApplyBackground(false);
      return inputStream;
    }

    if (!isWebGLSupported()) {
      setError("WebGL is not supported");
      onApplyBackground(false);
      return inputStream;
    }

    setError(undefined);

    const videoTrack = inputStream.getVideoTracks()[0];
    const { width, height } = videoTrack.getSettings();

    canvas.width = width ?? VIDEO_WIDTH_MAX;
    canvas.height = height ?? VIDEO_HEIGHT_MAX;

    const bgImage = new Image(canvas.width, canvas.height);
    bgImage.src = "/static/bg2.jpg";

    return await backgroundRemoval({ stream: inputStream, canvas, bgImage, effect });
  }, [canvasRef, clearBackgroundRemoval, onApplyBackground]);

  const backgroundRemoval = async ({
    stream,
    canvas,
    bgImage,
    effect,
  }: {
    stream: MediaStream;
    canvas: HTMLCanvasElement;
    bgImage: HTMLImageElement;
    effect: BgEffectType;
  }) => {
    const ctx = canvas.getContext("2d")!;

    const bufferCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const bufferCtx = bufferCanvas.getContext("2d")!;

    const newStream = new MediaStream(stream);

    // Создаем video элемент если его нет
    if (!videoElementRef.current) {
      videoElementRef.current = document.createElement("video");
    }

    videoElementRef.current.srcObject = newStream;
    videoElementRef.current.muted = true;
    videoElementRef.current.autoplay = true;
    await videoElementRef.current.play();

    if (!selfieSegmentationRef.current) {
      selfieSegmentationRef.current = new SelfieSegmentation({
        locateFile: (file) => `/static/selfie_segmentation/${file}`,
      });

      selfieSegmentationRef.current.setOptions({
        modelSelection: 1,
        selfieMode: false,
      });
    }

    const onResults: ResultsListener = (results) => {
      ctx.save();

      // Apply the background effect
      if (effect === 'blur') {
        bufferCtx.globalCompositeOperation = "copy";
        bufferCtx.filter = "blur(7px) sepia(1) brightness(0.7)";
        bufferCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(bufferCanvas, 0, 0);

        bufferCtx.filter = "none";
        bufferCtx.globalCompositeOperation = "source-over";
        bufferCtx.clearRect(0, 0, canvas.width, canvas.height);
        bufferCtx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
        bufferCtx.globalCompositeOperation = "source-atop";
        bufferCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      }

      if (effect === 'image') {
        // Draw the background image, stretched to cover the canvas
        bufferCtx.clearRect(0, 0, canvas.width, canvas.height);
        bufferCtx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);

        bufferCtx.globalCompositeOperation = "source-out";

        // Scale the background image to cover the canvas fully without distortion
        const imgAspectRatio = bgImage.width / bgImage.height;
        const canvasAspectRatio = canvas.width / canvas.height;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;

        if (imgAspectRatio > canvasAspectRatio) {
          // Image is wider than canvas, scale width to fill
          drawHeight = canvas.width / imgAspectRatio;
        } else {
          // Image is taller than canvas, scale height to fill
          drawWidth = canvas.height * imgAspectRatio;
        }

        // Center the background image on the canvas
        const offsetX = (canvas.width - drawWidth) / 2;
        const offsetY = (canvas.height - drawHeight) / 2;

        bufferCtx.drawImage(bgImage, offsetX, offsetY, drawWidth, drawHeight);

        bufferCtx.globalCompositeOperation = "destination-atop";
        bufferCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(bufferCanvas, 0, 0);

      ctx.restore();
    };

    selfieSegmentationRef.current.onResults(onResults);

    const drawFrame = async () => {
      if (selfieSegmentationRef.current && videoElementRef.current) {
        try {
          if (videoElementRef.current.videoWidth > 0 && videoElementRef.current.videoHeight > 0) {
            await selfieSegmentationRef.current.send({ image: videoElementRef.current });
          }
        } catch (error) {
          console.warn("selfieSegmentation: ", error);
        }
      }

      animationTimeoutRef.current = setTimeout(drawFrame, FRAME_MS);
    };

    await drawFrame();

    // Create a new video track with the modified background
    const processedStream = canvas.captureStream();
    const newVideoTrack = processedStream.getVideoTracks()[0];

    originalVideoTrackRef.current = newStream.getVideoTracks()[0];
    stream.removeTrack(originalVideoTrackRef.current);
    stream.addTrack(newVideoTrack);
    onApplyBackground(true);
  };

  return { applyBackgroundRemoval, clearBackgroundRemoval, error };
};
