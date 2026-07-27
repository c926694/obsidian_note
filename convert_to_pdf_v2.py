#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
将 Markdown 简历转换为 PDF (使用 reportlab)
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
import re

def parse_markdown_to_pdf(md_file: str, pdf_file: str):
    """解析 Markdown 并生成 PDF"""

    # 读取 Markdown 内容
    with open(md_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # 创建 PDF
    doc = SimpleDocTemplate(
        pdf_file,
        pagesize=A4,
        leftMargin=2*cm,
        rightMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm
    )

    # 注册中文字体
    try:
        pdfmetrics.registerFont(TTFont('SimSun', 'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))
        pdfmetrics.registerFont(TTFont('SimHei', 'C:/Windows/Fonts/simhei.ttf'))
        chinese_font = 'SimSun'
        bold_font = 'SimHei'
    except:
        chinese_font = 'Helvetica'
        bold_font = 'Helvetica-Bold'

    # 样式
    styles = getSampleStyleSheet()

    # 标题样式
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontName=bold_font,
        fontSize=20,
        textColor=HexColor('#2c3e50'),
        spaceAfter=12,
        alignment=TA_CENTER
    )

    # 二级标题样式
    heading2_style = ParagraphStyle(
        'CustomHeading2',
        parent=styles['Heading2'],
        fontName=bold_font,
        fontSize=14,
        textColor=HexColor('#2c3e50'),
        spaceAfter=10,
        spaceBefore=15
    )

    # 正文样式
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['BodyText'],
        fontName=chinese_font,
        fontSize=10,
        leading=16,
        textColor=HexColor('#333333')
    )

    # 粗体样式
    bold_style = ParagraphStyle(
        'CustomBold',
        parent=body_style,
        fontName=bold_font,
        fontSize=10
    )

    story = []

    for line in lines:
        line = line.rstrip()

        if not line or line == '---':
            story.append(Spacer(1, 0.3*cm))
            continue

        # H1 标题
        if line.startswith('# '):
            text = line[2:].strip()
            text = text.replace('**', '<b>').replace('**', '</b>')
            story.append(Paragraph(text, title_style))

        # H2 标题
        elif line.startswith('## '):
            text = line[3:].strip()
            story.append(Paragraph(f'<b>{text}</b>', heading2_style))

        # 列表项
        elif line.startswith('- '):
            text = line[2:].strip()
            # 处理加粗
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            # 处理代码块
            text = re.sub(r'`(.*?)`', r'<font face="Courier"><i>\1</i></font>', text)
            story.append(Paragraph(f'• {text}', body_style))

        # 普通文本
        else:
            text = line.strip()
            # 处理加粗
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            # 处理代码块
            text = re.sub(r'`(.*?)`', r'<font face="Courier"><i>\1</i></font>', text)
            story.append(Paragraph(text, body_style))

    # 生成 PDF
    doc.build(story)
    print(f"PDF generated: {pdf_file}")

if __name__ == "__main__":
    parse_markdown_to_pdf("简历.md", "简历.pdf")
