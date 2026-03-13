const cLocaleDecoder = new TextDecoder('latin1');
const LINE_FEED = 10;

export interface ByteLine {
  bytes: Uint8Array;
  text: string;
}

export interface ByteLineModel {
  lines: ByteLine[];
  endsWithNewline: boolean;
  byteLength: number;
}

export function createByteLineModel(data: Uint8Array): ByteLineModel {
  const lines: ByteLine[] = [];
  let lineStart = 0;

  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== LINE_FEED) {
      continue;
    }

    const lineBytes = data.slice(lineStart, index);
    lines.push({
      bytes: lineBytes,
      text: decodeCLocaleText(lineBytes),
    });
    lineStart = index + 1;
  }

  const endsWithNewline = data.length > 0 && data[data.length - 1] === LINE_FEED;
  if (lineStart < data.length) {
    const lineBytes = data.slice(lineStart);
    lines.push({
      bytes: lineBytes,
      text: decodeCLocaleText(lineBytes),
    });
  }

  return {
    lines,
    endsWithNewline,
    byteLength: data.length,
  };
}

export function decodeCLocaleText(data: Uint8Array): string {
  return cLocaleDecoder.decode(data);
}

export function encodeCLocaleText(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);

  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }

  return bytes;
}
