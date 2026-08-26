const extractEffectiveDate = (text = "") => {
  const match = text.match(
    /Effective\s+Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );

  if (!match) return null;

  const dateMatch = match[1].match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/
  );

  if (!dateMatch) return null;

  const [, monthName, day, year] = dateMatch;

  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  const month = months[monthName.toLowerCase()];
  if (!month) return null;

  return `${year}-${month}-${day.padStart(2, "0")}`;
};

const splitIntoSections = (text = "") => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = [];
  let currentSection = null;
  let currentText = [];

  const flush = () => {
    if (!currentText.length) return;
    sections.push({
      section: currentSection,
      text: currentText.join("\n").trim(),
    });
    currentText = [];
  };

  for (const line of lines) {
    const numbered = line.match(
      /^(\d+(?:\.\d+)*)[.)]\s+(.{2,120})$/
    );

    const heading = line.match(
      /^(#{1,6})\s+(.{2,120})$/
    );

    const uppercaseHeading =
      line.length <= 100 &&
      line.length >= 3 &&
      /^[A-Z][A-Z0-9 &/().:-]+$/.test(line);

    if (numbered) {
      flush();
      currentSection = numbered[2].trim();
      continue;
    }

    if (heading) {
      flush();
      currentSection = heading[2].trim();
      continue;
    }

    if (uppercaseHeading && !/[.!?]$/.test(line)) {
      flush();
      currentSection = line;
      continue;
    }

    currentText.push(line);
  }

  flush();

  if (!sections.length) {
    return [{ section: null, text: text.trim() }];
  }

  return sections;
};

const splitRecursive = (
  text,
  maxWords,
  overlapWords
) => {
  const normalized = String(text || "")
    .replace(/\r/g, "")
    .trim();

  if (!normalized) return [];

  const separators = [
    /\n\s*\n+/,
    /\n+/,
    /(?<=[.!?])\s+/,
    /(?<=[;:])\s+/,
  ];

  const leaves = [];

  const visit = (value, depth = 0) => {
    const words = value.split(/\s+/).filter(Boolean);

    if (
      words.length <= maxWords ||
      depth >= separators.length
    ) {
      leaves.push(value.trim());
      return;
    }

    const parts = value
      .split(separators[depth])
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      visit(value, depth + 1);
      return;
    }

    let buffer = [];

    const flush = () => {
      if (buffer.length) {
        leaves.push(buffer.join(" ").trim());
        buffer = [];
      }
    };

    for (const part of parts) {
      const combined = [...buffer, part].join(" ");
      if (
        combined.split(/\s+/).filter(Boolean).length <= maxWords
      ) {
        buffer.push(part);
      } else {
        flush();
        if (
          part.split(/\s+/).filter(Boolean).length > maxWords
        ) {
          visit(part, depth + 1);
        } else {
          buffer.push(part);
        }
      }
    }

    flush();
  };

  visit(normalized);

  const chunks = [];
  let carry = [];

  for (const leaf of leaves) {
    const words = leaf.split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) {
      chunks.push(leaf);
      continue;
    }

    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + maxWords, words.length);
      chunks.push(words.slice(start, end).join(" "));

      if (end === words.length) break;

      start = Math.max(
        end - overlapWords,
        start + 1
      );
    }
  }

  return chunks;
};

const createChunks = (pages = []) => {
  const chunks = [];
  let globalChunkIndex = 0;

  const maxWords = Math.max(
    120,
    Number(process.env.CHUNK_MAX_WORDS || 320)
  );

  const overlapWords = Math.max(
    20,
    Number(process.env.CHUNK_OVERLAP_WORDS || 60)
  );

  for (const page of pages) {
    const pageText = String(page.text || "").trim();
    if (!pageText) continue;

    const effectiveDate = extractEffectiveDate(pageText);
    const sections = splitIntoSections(pageText);

    for (const section of sections) {
      const parentText = section.text;
      const sectionChunks = splitRecursive(
        parentText,
        maxWords,
        overlapWords
      );

      sectionChunks.forEach((text, localIndex) => {
        const chunkIndex = globalChunkIndex;

        chunks.push({
          chunkIndex,
          localChunkIndex: localIndex,
          text,
          parentText,
          parentSection: section.section || null,
          section: section.section || null,
          effectiveDate,
          pageNumber: page.pageNumber ?? null,
          previousChunkIndex:
            chunkIndex > 0 ? chunkIndex - 1 : null,
          nextChunkIndex: chunkIndex + 1,
        });

        globalChunkIndex += 1;
      });
    }
  }

  if (chunks.length) {
    chunks[chunks.length - 1].nextChunkIndex = null;
  }

  return chunks;
};

module.exports = {
  createChunks,
  splitIntoSections,
  splitRecursive,
  extractEffectiveDate,
};
