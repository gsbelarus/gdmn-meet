import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  color?: string;
};

function IconBase({
  size = 24,
  color = "currentColor",
  children,
  ...props
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <g stroke={color} fill={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

export function BanIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" fill="none" />
      <path d="M7 17L17 7" fill="none" />
    </IconBase>
  );
}

export function BlurIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="16" cy="8" r="2.2" opacity="0.75" />
      <circle cx="8" cy="16" r="2.2" opacity="0.5" />
      <circle cx="16" cy="16" r="2.2" opacity="0.25" />
    </IconBase>
  );
}

export function Camera(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="13" height="10" rx="2" fill="none" />
      <path d="M16 10L21 7V17L16 14Z" />
    </IconBase>
  );
}

export function CameraSlash(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="7" width="13" height="10" rx="2" fill="none" />
      <path d="M16 10L21 7V17L16 14Z" />
      <path d="M4 19L20 5" fill="none" />
    </IconBase>
  );
}

export function CancelCallIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 15C6.5 12.5 9 11.5 12 11.5C15 11.5 17.5 12.5 20 15" fill="none" />
      <path d="M9 15L8 20" fill="none" />
      <path d="M15 15L16 20" fill="none" />
    </IconBase>
  );
}

export function GhostIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 18V9A5 5 0 0 1 17 9V18L14.5 16L12 18L9.5 16Z" fill="none" />
      <circle cx="10" cy="11" r="1" />
      <circle cx="14" cy="11" r="1" />
    </IconBase>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 14L14 10" fill="none" />
      <path d="M7.5 15.5L5.8 17.2A3 3 0 1 1 1.6 13L3.3 11.3" fill="none" />
      <path d="M20.7 12.7L22.4 11A3 3 0 1 0 18.2 6.8L16.5 8.5" fill="none" />
    </IconBase>
  );
}

export function MaskTheaterIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 7C8 7 10 5 12 5C14 5 16 7 19 7V14C19 16.8 15.8 19 12 19C8.2 19 5 16.8 5 14Z" fill="none" />
      <path d="M9 11H9.01" fill="none" />
      <path d="M15 11H15.01" fill="none" />
      <path d="M9 14C10 15 11 15.5 12 15.5C13 15.5 14 15 15 14" fill="none" />
    </IconBase>
  );
}

export function Microphone(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="4" width="6" height="10" rx="3" fill="none" />
      <path d="M6 11A6 6 0 0 0 18 11" fill="none" />
      <path d="M12 17V20" fill="none" />
      <path d="M9 20H15" fill="none" />
    </IconBase>
  );
}

export function MicrophoneSlash(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="4" width="6" height="10" rx="3" fill="none" />
      <path d="M6 11A6 6 0 0 0 18 11" fill="none" />
      <path d="M12 17V20" fill="none" />
      <path d="M9 20H15" fill="none" />
      <path d="M4 20L20 4" fill="none" />
    </IconBase>
  );
}

export function ObjectGroupIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" fill="none" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" fill="none" />
      <rect x="8.5" y="13" width="7" height="7" rx="1.5" fill="none" />
    </IconBase>
  );
}

export function SquareCaretDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" fill="none" />
      <path d="M8 10L12 14L16 10Z" />
    </IconBase>
  );
}

export function SquareCaretUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" fill="none" />
      <path d="M8 14L12 10L16 14Z" />
    </IconBase>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="3" fill="none" />
      <path d="M6 19C7.5 16.5 9.5 15.5 12 15.5C14.5 15.5 16.5 16.5 18 19" fill="none" />
    </IconBase>
  );
}
