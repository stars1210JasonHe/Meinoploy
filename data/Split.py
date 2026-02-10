from PIL import Image
import os

# Source image: 3x3 grid of character portraits
INPUT = "ChatGPT Image Feb 10, 2026, 11_02_29 PM.png"
OUTPUT_DIR = "heads"

# Map grid positions (row, col) to character names
CHARACTERS = [
    ["Albert-Victor",    "Lia-Startrace",    "Marcus-Grayline"],
    ["Evelyn-Zero",      "Knox-Ironlaw",     "Sophia-Ember"],
    ["Cassian-Echo",     "Mira-Dawnlight",   "Renn-Chainbreaker"],
]

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    img = Image.open(INPUT)
    w, h = img.size
    cell_w = w // 3
    cell_h = h // 3

    print(f"Source image: {w}x{h}, each cell: {cell_w}x{cell_h}")

    for row in range(3):
        for col in range(3):
            name = CHARACTERS[row][col]
            left = col * cell_w
            upper = row * cell_h
            right = left + cell_w
            lower = upper + cell_h

            cropped = img.crop((left, upper, right, lower))
            out_path = os.path.join(OUTPUT_DIR, f"{name}.png")
            cropped.save(out_path)
            print(f"  Saved: {out_path}")

    print(f"\nDone! {3*3} character heads saved to '{OUTPUT_DIR}/'")

if __name__ == "__main__":
    main()
