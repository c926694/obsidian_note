#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
将 Markdown 简历转换为 PDF
"""
import markdown
from weasyprint import HTML, CSS
from pathlib import Path

def convert_md_to_pdf(md_file: str, pdf_file: str):
    """将 Markdown 文件转换为 PDF"""

    # 读取 Markdown 文件
    with open(md_file, 'r', encoding='utf-8') as f:
        md_content = f.read()

    # 转换为 HTML
    html_content = markdown.markdown(md_content, extensions=['extra', 'codehilite'])

    # 添加 CSS 样式
    css_style = """
    @page {
        size: A4;
        margin: 2cm;
    }
    body {
        font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif;
        font-size: 11pt;
        line-height: 1.6;
        color: #333;
    }
    h1 {
        font-size: 24pt;
        color: #2c3e50;
        border-bottom: 3px solid #3498db;
        padding-bottom: 10px;
        margin-bottom: 20px;
    }
    h2 {
        font-size: 16pt;
        color: #2c3e50;
        margin-top: 25px;
        margin-bottom: 15px;
        border-bottom: 2px solid #ecf0f1;
        padding-bottom: 5px;
    }
    strong {
        color: #2c3e50;
        font-weight: bold;
    }
    ul {
        margin-left: 20px;
    }
    li {
        margin-bottom: 8px;
    }
    hr {
        border: none;
        border-top: 1px solid #ecf0f1;
        margin: 20px 0;
    }
    a {
        color: #3498db;
        text-decoration: none;
    }
    code {
        background-color: #f5f5f5;
        padding: 2px 5px;
        border-radius: 3px;
        font-family: "Courier New", monospace;
    }
    """

    # 完整的 HTML
    full_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>{css_style}</style>
    </head>
    <body>
        {html_content}
    </body>
    </html>
    """

    # 转换为 PDF
    HTML(string=full_html).write_pdf(pdf_file)
    print(f"✅ PDF 已生成: {pdf_file}")

if __name__ == "__main__":
    md_file = "简历.md"
    pdf_file = "简历.pdf"
    convert_md_to_pdf(md_file, pdf_file)
