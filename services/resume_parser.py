import os
import tempfile
import PyPDF2
from fastapi import UploadFile
import docx

class ResumeParser:
    @staticmethod
    async def parse_pdf(file: UploadFile) -> str:
        """Parses text from an uploaded PDF file."""
        try:
            # Read the file content
            content = await file.read()
            
            # Write to a secure temporary file since PyPDF2 needs a file object
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(content)
                temp_path = tmp.name
                
            text = ""
            with open(temp_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
                        
            # Clean up temp file
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
            return text.strip()
        except Exception as e:
            raise Exception(f"Failed to parse PDF: {str(e)}")

    @staticmethod
    async def parse_txt(file: UploadFile) -> str:
        """Parses text from an uploaded TXT file."""
        try:
            content = await file.read()
            return content.decode("utf-8").strip()
        except Exception as e:
            raise Exception(f"Failed to parse TXT: {str(e)}")

    @staticmethod
    async def parse_docx(file: UploadFile) -> str:
        """Parses text from an uploaded DOCX file."""
        try:
            content = await file.read()
            
            with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
                tmp.write(content)
                temp_path = tmp.name
                
            doc = docx.Document(temp_path)
            text = "\n".join([paragraph.text for paragraph in doc.paragraphs])
            
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
            return text.strip()
        except Exception as e:
            raise Exception(f"Failed to parse DOCX: {str(e)}")
