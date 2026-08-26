const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");

const cleanText = (text) => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const parsePDF = async (filePath) => {
  const buffer = fs.readFileSync(filePath);

  const options = {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();

      let pageText = "";

      for (const item of textContent.items) {
        pageText += item.str + " ";
      }

      return `\n---PAGE:${pageData.pageIndex + 1}---\n${pageText}\n`;
    },
  };

  const data = await pdf(buffer, options);

  const pages = data.text
    .split(/---PAGE:(\d+)---/)
    .reduce((result, value, index, array) => {
      if (index % 2 === 1) {
        const pageNumber = Number(value);
        const text = cleanText(array[index + 1] || "");

        result.push({
          pageNumber,
          text,
        });
      }

      return result;
    }, []);

  return {
    text: cleanText(data.text),
    pageCount: data.numpages,
    pages,
  };
};

const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({
    path: filePath,
  });

  const text = cleanText(result.value);

  return {
    text,
    pageCount: null,
    pages: [
      {
        pageNumber: null,
        text,
      },
    ],
  };
};

const parseTextFile = (filePath) => {
  const text = cleanText(fs.readFileSync(filePath, "utf8"));

  return {
    text,
    pageCount: null,
    pages: [
      {
        pageNumber: null,
        text,
      },
    ],
  };
};

const parseDocument = async (filePath) => {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".pdf":
      return await parsePDF(filePath);

    case ".docx":
      return await parseDOCX(filePath);

    case ".txt":
    case ".md":
      return parseTextFile(filePath);

    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
};

module.exports = {
  parseDocument,
};



