#!/usr/bin/env python3
"""
scripts/update_data.py
=============================================================================
Extracció i actualització automatitzada de les taules oficials de Ponderacions
i Notes de Tall de la Generalitat de Catalunya (Canal Universitats).

Genera el fitxer 'ponderaciones.csv' regularitzat per a l'institut i actualitza
els enllaços oficials a 'index.html'.
=============================================================================
"""

import sys
import os
import re
import io
import csv
import json
import argparse
import urllib.request
import pdfplumber

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
CSV_PATH = os.path.join(BASE_DIR, "ponderaciones.csv")
INDEX_PATH = os.path.join(BASE_DIR, "index.html")
SUBJECT_MAPPINGS_PATH = os.path.join(SCRIPTS_DIR, "subject_mappings.json")
SALIDES_PATH = os.path.join(SCRIPTS_DIR, "salides_professionals.json")

GENCAT_PONDERACIONS_PAGE = "https://universitats.gencat.cat/ca/preinscripcions/ponderacions/index.html"
GENCAT_NOTES_PAGE = "https://universitats.gencat.cat/ca/preinscripcions/sobre-preinscripcio/notes-tall/"
GENCAT_DOMAIN = "https://universitats.gencat.cat"

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def fetch_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()

def discover_latest_pdf_urls(target_year: int = 2026):
    """Descobreix automàticament els enllaços als PDFs més recents a la web de la Generalitat."""
    print(f"🔍 Buscant enllaços oficials a la web de la Generalitat (curs objectiu: {target_year})...")
    
    # 1. Ponderacions
    pond_url = None
    try:
        html = fetch_url(GENCAT_PONDERACIONS_PAGE).decode("utf-8", errors="ignore")
        links = []
        for href in re.findall(r'href=["\']([^"\']+\.pdf)["\']', html, re.IGNORECASE):
            # Filtrar per l'any objectiu si és possible
            if re.search(rf"Ponderacions-{target_year}_v\d+\.pdf", href, re.IGNORECASE):
                full_url = href if href.startswith("http") else GENCAT_DOMAIN + href
                links.append(full_url)
            elif re.search(r"Ponderacions-\d{4}_v\d+\.pdf", href, re.IGNORECASE) and not links:
                full_url = href if href.startswith("http") else GENCAT_DOMAIN + href
                links.append(full_url)
        if links:
            # Ordenar per número de versió vX
            def get_version(u):
                m = re.search(r"_v(\d+)\.pdf", u)
                return int(m.group(1)) if m else 0
            links.sort(key=get_version, reverse=True)
            pond_url = links[0]
            print(f"  ✓ PDF Ponderacions trobat: {pond_url}")
    except Exception as e:
        print(f"  ⚠️ Error consultant pàgina de ponderacions: {e}")

    # Fallback si no es troba
    if not pond_url:
        pond_url = f"https://universitats.gencat.cat/web/.content/02_preinscripcio/enllac-documents/Ponderacions-{target_year}_v7.pdf"
        print(f"  ℹ️ Usant URL Ponderacions per defecte: {pond_url}")

    # 2. Notes de tall
    notes_url = None
    try:
        html = fetch_url(GENCAT_NOTES_PAGE).decode("utf-8", errors="ignore")
        links = []
        for href in re.findall(r'href=["\']([^"\']+\.pdf)["\']', html, re.IGNORECASE):
            if re.search(r"(quadre_comparatiu_nota_tall|Notes-tall-1a-assignacio).*?\.pdf", href, re.IGNORECASE):
                full_url = href if href.startswith("http") else GENCAT_DOMAIN + href
                links.append(full_url)
        if links:
            comparatius = [l for l in links if "quadre_comparatiu" in l.lower()]
            notes_url = comparatius[0] if comparatius else links[0]
            print(f"  ✓ PDF Notes de tall trobat: {notes_url}")
    except Exception as e:
        print(f"  ⚠️ Error consultant pàgina de notes de tall: {e}")

    if not notes_url:
        notes_url = "https://universitats.gencat.cat/web/.content/02_preinscripcio/enllac-documents/notes-de-tall/quadre_comparatiu_nota_tall_juny_2025.pdf"
        print(f"  ℹ️ Usant URL Notes de tall per defecte: {notes_url}")

    return pond_url, notes_url

def parse_ponderacions_pdf(pdf_bytes: bytes, num_subject_cols: int = 27):
    """
    Extreu les files de graus i ponderacions del PDF de Ponderacions.
    Retorna un diccionari {codi_grau: {nom, univ, branca, weights: [w1, w2, ...]}}
    """
    print("📄 Processant taules del PDF de Ponderacions...")
    degrees = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for p_idx, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            for t in tables:
                for row in t:
                    if not row or len(row) < 5:
                        continue
                    code = (row[0] or "").strip()
                    # Comprovar si és un codi de 5 dígits de grau
                    if re.match(r"^\d{5}$", code):
                        raw_name = (row[1] or "").strip().replace("\n", " ")
                        # Netejar espais duplicats i dobles cometes
                        name = re.sub(r"\s+", " ", raw_name)
                        univ = (row[2] or "").strip().replace("\n", "")
                        branca = (row[3] or "").strip().replace("\n", "")
                        
                        # Les columnes 4 fins a 4 + num_subject_cols són les ponderacions
                        raw_weights = row[4:4 + num_subject_cols]
                        clean_weights = []
                        for cell in raw_weights:
                            val = (cell or "").strip().replace(".", ",")
                            clean_weights.append(val if val in ("0,1", "0,2") else "")
                        
                        # Omplir si falten columnes
                        while len(clean_weights) < num_subject_cols:
                            clean_weights.append("")

                        degrees[code] = {
                            "code": code,
                            "name": name,
                            "univ": univ,
                            "branca": branca,
                            "weights": clean_weights[:num_subject_cols]
                        }
    print(f"  ✓ Total graus extrets de Ponderacions: {len(degrees)}")
    return degrees

def parse_notes_tall_pdf(pdf_bytes: bytes):
    """
    Extreu les notes de tall, places i població del PDF de Notes de tall.
    Retorna un diccionari {codi_grau: {poblacio, places, nota, univ}}
    """
    print("📄 Processant taules del PDF de Notes de Tall...")
    notes = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for t in tables:
                for row in t:
                    if not row or len(row) < 7:
                        continue
                    code = (row[0] or "").strip()
                    if re.match(r"^\d{5}$", code):
                        poblacio = (row[2] or "").strip().replace("\n", " ")
                        univ = (row[3] or "").strip().replace("\n", "")
                        places = (row[4] or "").strip().replace("\n", "")
                        
                        # Nota PAU/CFGS final (generalment a la columna 6 o 5 depenent del format)
                        # Al quadre comparatiu: col 5 és inici del procés, col 6 és final del procés
                        nota_final = (row[6] or "").strip().replace("\n", "").replace(".", ",")
                        if not nota_final and len(row) > 5:
                            nota_final = (row[5] or "").strip().replace("\n", "").replace(".", ",")

                        # Validar format numèric de nota (ex: 7,424 o 5 o 5,000)
                        if nota_final and not re.match(r"^\d+(?:,\d+)?$", nota_final):
                            nota_final = "5"

                        notes[code] = {
                            "poblacio": poblacio,
                            "univ": univ,
                            "places": places,
                            "nota": nota_final or "5"
                        }
    print(f"  ✓ Total graus extrets de Notes de Tall: {len(notes)}")
    return notes

def load_configs():
    with open(SUBJECT_MAPPINGS_PATH, "r", encoding="utf-8") as f:
        subj_cfg = json.load(f)
    with open(SALIDES_PATH, "r", encoding="utf-8") as f:
        salides_cfg = json.load(f)
    return subj_cfg, salides_cfg

def get_salides_score(code: str, name: str, branca: str, salides_cfg: dict) -> int:
    by_id = salides_cfg.get("by_id", {})
    if code in by_id:
        return by_id[code]
    by_name = salides_cfg.get("by_degree_name", {})
    if name in by_name:
        return by_name[name]
    
    # Per branca
    branca_map = {
        "EA": "Enginyeria i Arquitectura",
        "CS": "Ciències de la Salut",
        "C": "Ciències",
        "CSJ": "Ciències Socials i Jurídiques",
        "AH": "Arts i Humanitats"
    }
    branca_nom = branca_map.get(branca, "General")
    default_by_area = salides_cfg.get("default_by_area", {})
    return default_by_area.get(branca_nom, 6)

def update_index_html_urls(pond_url: str, notes_url: str):
    """Actualitza les constants PDF_NOTES_TALL i PDF_PONDERACIONS a index.html."""
    if not os.path.exists(INDEX_PATH):
        return
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    new_content = re.sub(
        r'const PDF_NOTES_TALL\s*=\s*"[^"]*";',
        f'const PDF_NOTES_TALL = "{notes_url}";',
        content
    )
    new_content = re.sub(
        r'const PDF_PONDERACIONS\s*=\s*"[^"]*";',
        f'const PDF_PONDERACIONS = "{pond_url}";',
        new_content
    )

    if new_content != content:
        with open(INDEX_PATH, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("  ✓ index.html actualitzat amb les noves URLs oficials dels PDFs.")

def main():
    parser = argparse.ArgumentParser(description="Actualitzador de Ponderacions i Notes de Tall Gencat.")
    parser.add_argument("--year", type=int, default=2026, help="Any acadèmic de la convocatòria (per defecte 2026)")
    parser.add_argument("--ponderacions-url", help="URL o camí al PDF de ponderacions")
    parser.add_argument("--notes-url", help="URL o camí al PDF de notes de tall")
    parser.add_argument("--dry-run", action="store_true", help="No escriure fitxers al disc")
    args = parser.parse_args()

    # 1. URLs
    pond_url = args.ponderacions_url if hasattr(args, "ponderacions_url") and args.ponderacions_url else None
    notes_url = args.notes_url if hasattr(args, "notes_url") and args.notes_url else None

    if not pond_url or not notes_url:
        discovered_pond, discovered_notes = discover_latest_pdf_urls(target_year=args.year)
        pond_url = pond_url or discovered_pond
        notes_url = notes_url or discovered_notes

    # 2. Carregar fitxers de configuració
    subj_cfg, salides_cfg = load_configs()
    mappings = subj_cfg.get("mappings", [])
    csv_subject_headers = [m["csv_name"] for m in mappings]
    num_subject_cols = len(mappings)

    # 3. Descarregar PDFs
    print(f"📥 Descarregant Ponderacions des de: {pond_url}")
    pond_bytes = fetch_url(pond_url)
    print(f"📥 Descarregant Notes de Tall des de: {notes_url}")
    notes_bytes = fetch_url(notes_url)

    # 4. Parsejar PDFs
    degrees = parse_ponderacions_pdf(pond_bytes, num_subject_cols)
    notes = parse_notes_tall_pdf(notes_bytes)

    # 5. Generar files CSV
    csv_rows = []
    # Capçalera exacta compatible
    header = ["Oportunitats", "ID", "Grau", "Universitat", "Poblacio", "Plaçes orientatives", "Nota"] + csv_subject_headers
    csv_rows.append(header)

    # Ordenar graus pel codi
    sorted_codes = sorted(degrees.keys())

    for code in sorted_codes:
        deg = degrees[code]
        note_info = notes.get(code, {})
        
        # Poblacio, places, nota
        poblacio = note_info.get("poblacio", "")
        places = note_info.get("places", "")
        nota = note_info.get("nota", "5")
        univ = deg["univ"] or note_info.get("univ", "")

        # Puntuació de sortides professionals
        salides_score = get_salides_score(code, deg["name"], deg["branca"], salides_cfg)

        row = [
            str(salides_score),
            code,
            deg["name"],
            univ,
            poblacio,
            places,
            nota
        ] + deg["weights"]

        csv_rows.append(row)

    print(f"📊 Total files generades per a ponderaciones.csv: {len(csv_rows) - 1}")

    if args.dry_run:
        print("🔍 Mode DRY-RUN: No s'ha desat cap fitxer.")
        return

    # 6. Escriure ponderaciones.csv amb UTF-8 BOM
    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerows(csv_rows)

    print(f"✅ 'ponderaciones.csv' actualitzat correctament a: {CSV_PATH}")

    # 7. Actualitzar index.html
    update_index_html_urls(pond_url, notes_url)
    print("🚀 Procés completat amb èxit!")

if __name__ == "__main__":
    main()
