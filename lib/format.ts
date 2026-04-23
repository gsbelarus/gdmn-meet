export function convertBytes(bytes: number) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const value = size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${value} ${units[index]}`;
}
