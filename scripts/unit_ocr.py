"""Extract *candidate* shop IDs from floor photographs.

A single OCR pass is used only if pytesseract and Tesseract are installed.
Never equate OCR text to a verified tenancy or attach to the nearest shop.
"""
import re

CODE=re.compile(r"^[A-Z]{1,3}[0-9]?[-–]?[0-9]{1,3}(?:[-/][0-9]{1,3})?$")

def scan(image):
    try:
        import cv2
        import pytesseract
        import numpy as np
        from pytesseract import Output
        bright=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        scaled=cv2.resize(bright,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)
        data=pytesseract.image_to_data(scaled,config="--psm 11",output_type=Output.DICT)
    except (ImportError,RuntimeError,OSError):
        return [],"OCR unavailable: install pytesseract plus tesseract binary"
    result={}
    for i,text in enumerate(data["text"]):
        token=text.strip().upper().replace("–","-")
        conf=float(data["conf"][i])
        if conf<65 or not CODE.fullmatch(token):
            continue
        x=round((int(data["left"][i])+int(data["width"][i])*.5)/2,1)
        y=round((int(data["top"][i])+int(data["height"][i])*.5)/2,1)
        if token not in result or conf>result[token]["confidence"]:
            result[token]={"code":token,"x":x,"y":y,
                "source":"ocr-unreviewed","confidence":conf}
    return list(result.values()),"OCR candidates require human review"
