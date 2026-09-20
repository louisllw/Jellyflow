function absoluteUri(uri, masterUrl) {
  return new URL(uri, masterUrl).toString();
}

function absoluteMediaLine(line, masterUrl) {
  return line.replace(/URI="([^"]+)"/, (_match, uri) => `URI="${absoluteUri(uri, masterUrl)}"`);
}

export function combineHlsMasters(masters) {
  const mediaLines = [];
  const variants = [];
  const seenMedia = new Set();
  const seenVariants = new Set();

  masters.forEach(({ text, url }, masterIndex) => {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (masterIndex === masters.length - 1 && line.startsWith("#EXT-X-MEDIA:")) {
        const absolute = absoluteMediaLine(line, url);
        if (!seenMedia.has(absolute)) {
          seenMedia.add(absolute);
          mediaLines.push(absolute);
        }
      }
      if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
      const uri = lines[index + 1];
      if (!uri || uri.startsWith("#")) continue;
      const absolute = absoluteUri(uri, url);
      if (!seenVariants.has(absolute)) {
        seenVariants.add(absolute);
        variants.push(`${line}\n${absolute}`);
      }
      index += 1;
    }
  });

  if (!variants.length) throw new Error("Jellyfin returned no adaptive HLS variants.");
  return ["#EXTM3U", "#EXT-X-INDEPENDENT-SEGMENTS", ...mediaLines, ...variants, ""].join("\n");
}
