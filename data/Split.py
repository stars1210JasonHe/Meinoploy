from PIL import Image
import os

def split_pixel_portraits(
    image_path: str,
    rows: int,
    cols: int,
    output_dir: str,
    names: list[str],
    padding: int = 0
):
    """
    将 2D 像素角色九宫格切割成单独头像

    :param image_path: 原始九宫格图片路径
    :param rows: 行数（例如 3）
    :param cols: 列数（例如 3）
    :param output_dir: 输出目录
    :param names: 角色名称列表（长度 = rows * cols）
    :param padding: 每个头像四周裁剪内缩像素（可选）
    """

    img = Image.open(image_path)
    width, height = img.size

    cell_w = width // cols
    cell_h = height // rows

    os.makedirs(output_dir, exist_ok=True)

    index = 0
    for r in range(rows):
        for c in range(cols):
            if index >= len(names):
                break

            left = c * cell_w + padding
            upper = r * cell_h + padding
            right = (c + 1) * cell_w - padding
            lower = (r + 1) * cell_h - padding

            portrait = img.crop((left, upper, right, lower))

            filename = f"{index+1:02d}_{names[index]}.png"
            portrait.save(os.path.join(output_dir, filename))

            index += 1

    print(f"✅ 已输出 {index} 个角色头像到 {output_dir}")
