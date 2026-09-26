"""Bounded, signature-checked resume extraction."""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pypdf
import docx
from fastapi import UploadFile


MAX_RESUME_BYTES = 5 * 1024 * 1024
MAX_EXTRACTED_TEXT_CHARS = 200_000
MAX_DOCX_FILES = 2_000
MAX_DOCX_EXPANDED_BYTES = 40 * 1024 * 1024


@dataclass
class ResumeParseError(ValueError):
    code: str
    message: str
    status_code: int = 422

    def __str__(self) -> str:
        return self.message


async def _read_bounded(file: UploadFile) -> bytes:
    content = await file.read(MAX_RESUME_BYTES + 1)
    if len(content) > MAX_RESUME_BYTES:
        raise ResumeParseError("resume_too_large", "Resume files may not exceed 5 MB", 413)
    if not content:
        raise ResumeParseError("resume_empty", "The resume file is empty")
    return content


def _bounded_text(text: str) -> str:
    normalized = text.replace("\x00", " ").strip()
    if len(normalized) > MAX_EXTRACTED_TEXT_CHARS:
        raise ResumeParseError("resume_text_too_large", "The resume contains too much extracted text", 413)
    return normalized


class ResumeParser:
    @staticmethod
    async def parse(file: UploadFile) -> str:
        suffix = Path(file.filename or "").suffix.lower()
        if suffix == ".pdf":
            return await ResumeParser.parse_pdf(file)
        if suffix == ".docx":
            return await ResumeParser.parse_docx(file)
        if suffix == ".txt":
            return await ResumeParser.parse_txt(file)
        raise ResumeParseError("resume_type_unsupported", "Use a PDF, DOCX, or UTF-8 TXT resume", 415)

    @staticmethod
    async def parse_pdf(file: UploadFile) -> str:
        content = await _read_bounded(file)
        if not content.startswith(b"%PDF-"):
            raise ResumeParseError("resume_signature_invalid", "This file is not a valid PDF", 415)
        try:
            reader = pypdf.PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted:
                raise ResumeParseError(
                    "pdf_encrypted",
                    "Encrypted PDFs cannot be read. Paste the resume text instead.",
                )
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ResumeParseError:
            raise
        except Exception as exc:
            raise ResumeParseError("pdf_invalid", "The PDF could not be read. Paste the resume text instead.") from exc
        text = _bounded_text(text)
        if not text:
            raise ResumeParseError(
                "pdf_scanned",
                "No selectable text was found. This may be a scanned PDF; paste the resume text instead.",
            )
        return text

    @staticmethod
    async def parse_txt(file: UploadFile) -> str:
        content = await _read_bounded(file)
        if b"\x00" in content:
            raise ResumeParseError("resume_signature_invalid", "This is not a UTF-8 text file", 415)
        try:
            return _bounded_text(content.decode("utf-8", errors="strict"))
        except UnicodeDecodeError as exc:
            raise ResumeParseError("resume_encoding_invalid", "Text resumes must use UTF-8 encoding", 415) from exc

    @staticmethod
    async def parse_docx(file: UploadFile) -> str:
        content = await _read_bounded(file)
        if not content.startswith(b"PK"):
            raise ResumeParseError("resume_signature_invalid", "This file is not a valid DOCX", 415)
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > MAX_DOCX_FILES:
                    raise ResumeParseError("docx_archive_unsafe", "The DOCX contains too many embedded files")
                expanded = 0
                for entry in entries:
                    expanded += max(0, entry.file_size)
                    if expanded > MAX_DOCX_EXPANDED_BYTES:
                        raise ResumeParseError("docx_archive_unsafe", "The DOCX expands beyond the safe limit")
                    target = Path(entry.filename.replace("\\", "/"))
                    if target.is_absolute() or ".." in target.parts:
                        raise ResumeParseError("docx_archive_unsafe", "The DOCX contains unsafe paths")
                if "word/document.xml" not in archive.namelist():
                    raise ResumeParseError("resume_signature_invalid", "This archive is not a DOCX", 415)
            document = docx.Document(io.BytesIO(content))
            text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        except ResumeParseError:
            raise
        except (zipfile.BadZipFile, KeyError, ValueError) as exc:
            raise ResumeParseError("docx_invalid", "The DOCX could not be read") from exc
        return _bounded_text(text)
