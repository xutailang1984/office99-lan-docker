# P4／P5 办公室短音效

本目录为本轮原创分层制作，生成脚本 `tools/audio/generate-office45.mjs`。每类两个确定性变体。生产文件均为 48 kHz、单声道、16 位 PCM WAV；不覆盖旧资源，运行时接入由主清单负责。

纸张和金属卡扣层取自项目已有 `interactions/archive_rummage_01.wav`、`archive_rummage_03.wav`、`archive_open_01.wav`、`archive_open_02.wav`。其原始来源是 OwlishMedia 的 [202 More Sound Effects](https://opengameart.org/content/202-more-sound-effects)，许可 CC0 1.0。原始采样和处理记录见上一级 `SOURCES.md` 及 `interactions/interaction-build.json`。

软撞、护甲轻碰和杯碰层取自已有 `impacts/enemy_body_01.wav`、`enemy_armor_01.wav`、`glass_01.wav`，原始来源是 Kenney [Impact Sounds](https://kenney.nl/assets/impact-sounds)，许可 CC0 1.0。这些是风格化素材，不能宣称为新的实地录音。原始素材记录见 `impacts/impact-build.json`。

额外的低转速电机、纸流、呼气和橡胶振动层由脚本确定性合成，不包含人声、商业录音或音乐。合成层及本目录原创编排以 CC0 1.0 提供。未下载新素材。每项依赖和最终输出的 SHA256、峰值与 RMS 记录于 `build.json`。峰值整理到 0.72 上限，短淡入淡出、低通和软限幅控制高频与爆音。

`audition.wav` 按下面顺序串联第一个变体，各段间隔 0.25 秒，供集中试听；它不需要加入运行时清单。生成成功只证明格式和非静音，主观听感仍需人工评价。

| 类别 | 声音组成 | gain | priority | cooldown_ms |
| --- | --- | --- | --- | --- |
| motor_start | 卡扣、低电机起转、纸屑 | 0.58 | 64 | 300 |
| paper_wave | 分层纸浪、低纸卷滚动 | 0.60 | 66 | 260 |
| broadcast | 按键、低沉双段提示 | 0.42 | 54 | 550 |
| coffee_share | 轻杯碰、液体晃动 | 0.42 | 48 | 450 |
| highfive | 短掌声、软撞、衣袖 | 0.45 | 48 | 400 |
| paper_throw | 抛纸、皱折尾声 | 0.35 | 40 | 180 |
| stamp | 软盖章、抬起卡扣 | 0.40 | 43 | 240 |
| duck | 圆钝双段橡胶吱声、气流 | 0.36 | 42 | 650 |

相较既有开枪声音，新音效使用更低优先级。社交声音建议另沿全局 32 声道以及目标重复命中的冷却限制；声音不能盖住战斗预警。
