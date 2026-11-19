# 音效来源与许可

本目录仅放入可随游戏发布的音效及其派生文件。运行时清单见 `manifest.json`。

## Free Firearm Sound Library

- 原始资源：The Free Firearm Sound Library，Ben Jaszczak、Brian Nelson、Kevin Heras、Matthew Nanney。
- 来源：https://opengameart.org/content/the-free-firearm-sound-library
- 许可：CC0 1.0，无需署名，可修改和商业发布。
- 下载日期：2026-09-21。
- 原始归档：`Prepared SFX Library.7z`，只在本地制作缓存中保留；游戏仅包含裁切、降采样和混音后的短音效。
- 制作：`tools/audio/build_weapon_sfx.py`。保留瞬态与环境尾声，转换为48 kHz单声道16位WAV，并加入较轻的办公室机械识别层。

## Kenney Impact Sounds

- 原始资源：Impact Sounds 1.0，Kenney。
- 来源：https://kenney.nl/assets/impact-sounds
- 许可：CC0 1.0，无需署名，可修改和商业发布。
- 下载日期：2026-09-21。
- 游戏使用原包中的少量OGG，用于木材、金属和硬质表面撞击及破坏。
- 新增怪物普通命中、护甲、弱点与玻璃轻击使用同一原包的 `impactSoft_medium`、`impactPunch_medium`、`impactMetal_light` 和 `impactGlass_light` 样本。它们是 Kenney 制作的风格化音效，不宣称为真实撞击录音。每种两段短变体，经混合、裁短与峰值整理后输出为 48 kHz／16 位／单声道 WAV，保留开火声在混音中的主导位置。
- 制作：`tools/audio/build_impact_sfx.py`；逐文件源名和 SHA256 见 `impacts/impact-build.json`。本地制作缓存保留 Kenney 原包及其许可，游戏只包含派生短音。

## OpenGameArt Gun reload sounds

- 原始资源：Gun reload sounds，SpringySpringo。
- 来源：https://opengameart.org/content/gun-reload-sounds
- 许可：CC0 1.0，无需署名。
- 下载日期：2026-09-21。
- 游戏使用原始WAV的裁切、单声道和响度整理版本。

## OpenGameArt 202 More Sound Effects

- 原始资源：202 More Sound Effects，OwlishMedia。
- 来源：https://opengameart.org/content/202-more-sound-effects
- 许可：CC0 1.0，无需署名，可修改和商业发布。
- 下载日期：2026-09-21。
- 原始归档SHA256：`9428C1437137D9EA06BA94E13DA12488D4C57990A1C32D83DB9E7707E69FB3AF`。
- 翻找档案选用：`Paper & Stationery/Stationery_01.wav`、`Stationery_06.wav`、`Stationery_08.wav`。这些样本包含连续、短促且强度不同的纸张摩擦，适合循环中的随机变化。
- 打开抽屉选用：`Keys, Locks, Door/Key_Lock_Door_30.wav`、`Key_Lock_Door_39.wav`、`Key_Lock_Door_51.wav`。这些样本是短金属锁扣或滑轨瞬态，不带长门板尾声。
- 制作：`tools/audio/build_interaction_sfx.py`。裁去首尾静音，保留原始瞬态，轻度限幅并转换为48 kHz单声道16位WAV；构建记录见`interactions/interaction-build.json`。

许可正文：https://creativecommons.org/publicdomain/zero/1.0/
