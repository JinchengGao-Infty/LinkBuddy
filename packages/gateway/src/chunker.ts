export function chunkMessage(text: string, maxLength: number): string[] {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';
  let isRemainder = false;

  for (const line of text.split('\n')) {
    const withLine = current ? current + '\n' + line : line;

    if (withLine.length <= maxLength) {
      current = withLine;
      isRemainder = false;
    } else if (!current) {
      let remaining = line;
      while (remaining.length > maxLength) {
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      current = remaining;
      isRemainder = true;
    } else if (isRemainder) {
      // Remainder from a hard split: combine with next line only if it fits
      if (withLine.length <= maxLength) {
        current = withLine;
        isRemainder = false;
      } else {
        chunks.push(current);
        current = line;
        isRemainder = false;
      }
    } else {
      chunks.push(current);
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        current = remaining;
        isRemainder = true;
      } else {
        current = line;
        isRemainder = false;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
