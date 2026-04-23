"use client";
import { useEffect, useRef, useState } from 'react';

type Props = {
  mediaStream: MediaStream | null | undefined;
  soundCheck?: boolean;
  checkOnce?: boolean;
};

const lowSoundThreshold = 25;
const soundCheckInterval = 10_000;
const volumeUpdateInterval = 300;

export const useMicVolume = ({ mediaStream, checkOnce, soundCheck }: Props) => {

  const [micVolume, setMicVolume] = useState<number>(0);
  const [isLowVolumeDetected, setIsLowVolumeDetected] = useState(false);

  const prevVolumeRef = useRef<number>(0);
  const audioTrackId = mediaStream?.getAudioTracks()[0]?.id;

  useEffect(() => {
    if (!audioTrackId || !mediaStream || !mediaStream.active) {
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(mediaStream);
    // Array of volume values during 10 sec
    let volumeCheckValues: number[] = [];

    microphone.connect(analyser);
    analyser.fftSize = 512;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let timeout: NodeJS.Timeout | undefined = undefined;
    let volumeCheckTimeout: NodeJS.Timeout | undefined = undefined;

    const updateVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((acc, val) => acc + val, 0);
      const norm = sum / dataArray.length;
      const volume = Math.ceil(norm);

      if (soundCheck) {
        volumeCheckValues.push(volume);

        // Если звук превышает порог, меняем флаг
        if (volume > lowSoundThreshold) {
          setIsLowVolumeDetected(false);
        }
      }

      if (volume !== prevVolumeRef.current) {
        setMicVolume(volume);
        prevVolumeRef.current = volume;
      }
      timeout = setTimeout(updateVolume, volumeUpdateInterval);
    };

    updateVolume();

    const performSoundCheck = () => {

      volumeCheckTimeout = setTimeout(() => {
        // Проверка всех значений после 10 секунд
        if (volumeCheckValues.length > 0 && volumeCheckValues.every(value => value <= lowSoundThreshold)) {
          setIsLowVolumeDetected(true);
        }

        volumeCheckValues = [];

        if (!checkOnce) {
          performSoundCheck();
        }

      }, soundCheckInterval);
    };

    if (soundCheck) {
      performSoundCheck();
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (volumeCheckTimeout) {
        clearTimeout(volumeCheckTimeout);
      }

      if (audioContext.state !== 'closed') {
        audioContext.close();
      }
    };
  }, [audioTrackId, mediaStream, soundCheck, checkOnce]);

  return {
    /**
     * The current microphone volume level.
     * It is a number from 0 to 100.
     */
    micVolume,
    /**
     * Volume is too low
     */
    isLowVolumeDetected
  };
};
