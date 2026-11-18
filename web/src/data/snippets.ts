export interface Snippet { zh: string; en: string }
export interface SnippetGroup { key: string; name: string; items: Snippet[] }

const s = (zh: string, en: string): Snippet => ({ zh, en })

export const snippetGroups: SnippetGroup[] = [
  {
    key: 'style', name: '风格', items: [
      s('电影剧照', 'cinematic film still'), s('胶片摄影', 'analog film photography, 35mm'),
      s('日系清新', 'Japanese airy aesthetic'), s('赛博朋克', 'cyberpunk'),
      s('水彩插画', 'watercolor illustration'), s('国风工笔', 'Chinese gongbi painting'),
      s('水墨写意', 'Chinese ink wash painting'), s('吉卜力动画', 'Studio Ghibli style animation'),
      s('皮克斯 3D', 'Pixar style 3D render'), s('极简主义', 'minimalism'),
      s('复古海报', 'vintage poster'), s('蒸汽波', 'vaporwave'),
      s('油画厚涂', 'impasto oil painting'), s('浮世绘', 'ukiyo-e woodblock print'),
      s('像素艺术', 'pixel art'), s('低多边形', 'low poly'),
    ],
  },
  {
    key: 'subject', name: '画面主体', items: [
      s('少女半身像', 'half-body portrait of a young woman'), s('老人特写', 'close-up of an elderly man'),
      s('橘猫', 'ginger cat'), s('柴犬', 'shiba inu'),
      s('未来城市', 'futuristic city'), s('江南古镇', 'ancient water town in Jiangnan'),
      s('雪山湖泊', 'snowy mountains and an alpine lake'), s('咖啡杯静物', 'still life of a coffee cup'),
      s('机甲战士', 'mecha warrior'), s('宇航员', 'astronaut'),
      s('精灵弓箭手', 'elf archer'), s('香水瓶', 'perfume bottle'),
      s('街头小吃摊', 'street food stall'), s('樱花树', 'cherry blossom tree'),
    ],
  },
  {
    key: 'light', name: '光影', items: [
      s('黄金时刻', 'golden hour'), s('蓝调时刻', 'blue hour'),
      s('伦勃朗光', 'Rembrandt lighting'), s('逆光剪影', 'backlit silhouette'),
      s('丁达尔光', 'god rays, volumetric light'), s('柔和窗光', 'soft window light'),
      s('霓虹灯光', 'neon lighting'), s('烛光暖调', 'warm candlelight'),
      s('硬光高反差', 'hard light, high contrast'), s('边缘光', 'rim light'),
      s('阴天漫射光', 'overcast diffused light'), s('影棚三点布光', 'studio three-point lighting'),
    ],
  },
  {
    key: 'camera', name: '镜头', items: [
      s('85mm 人像镜头', '85mm portrait lens'), s('35mm 人文镜头', '35mm lens'),
      s('广角镜头', 'wide-angle lens'), s('微距镜头', 'macro lens'),
      s('长焦压缩', 'telephoto compression'), s('鱼眼镜头', 'fisheye lens'),
      s('浅景深', 'shallow depth of field, f/1.4'), s('移轴摄影', 'tilt-shift photography'),
      s('航拍俯瞰', 'aerial drone shot'), s('低角度仰拍', 'low-angle shot'),
      s('第一人称视角', 'first-person POV'), s('长曝光', 'long exposure'),
    ],
  },
  {
    key: 'composition', name: '构图', items: [
      s('三分法构图', 'rule of thirds'), s('中心对称', 'centered symmetrical composition'),
      s('引导线', 'leading lines'), s('框中框', 'frame within a frame'),
      s('大面积留白', 'generous negative space'), s('特写', 'close-up'),
      s('全身像', 'full-body shot'), s('俯拍平铺', 'flat lay, top-down'),
      s('对角线构图', 'diagonal composition'), s('前景虚化', 'blurred foreground'),
      s('远景全景', 'wide establishing shot'), s('黄金螺旋', 'golden spiral composition'),
    ],
  },
  {
    key: 'color', name: '色彩', items: [
      s('莫兰迪色', 'Morandi muted palette'), s('高饱和撞色', 'vibrant complementary colors'),
      s('黑白', 'black and white'), s('青橙色调', 'teal and orange grading'),
      s('马卡龙色', 'pastel macaron colors'), s('复古暖黄', 'vintage warm yellow tone'),
      s('冷蓝色调', 'cool blue tones'), s('单色系', 'monochromatic palette'),
      s('大地色系', 'earth tones'), s('霓虹粉紫', 'neon pink and purple'),
      s('低饱和', 'desaturated'), s('金色点缀', 'gold accents'),
    ],
  },
  {
    key: 'material', name: '材质', items: [
      s('磨砂玻璃', 'frosted glass'), s('拉丝金属', 'brushed metal'),
      s('丝绸', 'silk fabric'), s('陶瓷釉面', 'glazed ceramic'),
      s('粗糙石材', 'rough stone texture'), s('胡桃木纹', 'walnut wood grain'),
      s('皮革', 'leather'), s('液态金属', 'liquid metal'),
      s('羊毛毡', 'needle felt'), s('宣纸肌理', 'rice paper texture'),
      s('全息镭射', 'holographic iridescent'), s('黏土质感', 'claymation texture'),
    ],
  },
  {
    key: 'mood', name: '氛围', items: [
      s('宁静治愈', 'serene and healing'), s('孤独感', 'sense of solitude'),
      s('梦幻朦胧', 'dreamy and hazy'), s('神秘幽暗', 'mysterious and dark'),
      s('热闹烟火气', 'lively everyday bustle'), s('史诗宏大', 'epic and grand'),
      s('怀旧', 'nostalgic'), s('浪漫', 'romantic'),
      s('紧张压迫', 'tense and oppressive'), s('清晨薄雾', 'morning mist'),
      s('雨夜', 'rainy night'), s('童话感', 'fairytale atmosphere'),
    ],
  },
  {
    key: 'quality', name: '画质增强', items: [
      s('超高清细节', 'ultra-detailed'), s('8K 分辨率', '8K resolution'),
      s('锐利对焦', 'sharp focus'), s('专业摄影', 'professional photography'),
      s('杂志封面质感', 'magazine cover quality'), s('细腻皮肤纹理', 'detailed skin texture'),
      s('物理渲染', 'physically based rendering'), s('光线追踪', 'ray tracing'),
      s('获奖作品', 'award-winning'), s('精致排版', 'refined typography'),
      s('HDR', 'HDR'), s('胶片颗粒', 'subtle film grain'),
    ],
  },
  {
    key: 'negative', name: '负面', items: [
      s('不要文字水印', 'no text, no watermark'), s('不要畸形手指', 'no deformed fingers'),
      s('不要模糊', 'no blur'), s('不要多余肢体', 'no extra limbs'),
      s('不要低分辨率', 'no low resolution'), s('不要过曝', 'no overexposure'),
      s('不要噪点', 'no noise'), s('不要变形五官', 'no distorted face'),
      s('不要边框', 'no border'), s('不要卡通化', 'not cartoonish'),
      s('不要杂乱背景', 'no cluttered background'), s('不要重复元素', 'no duplicated elements'),
    ],
  },
]

export interface Template { key: string; name: string; cover: string; content: string; tags: string[] }

export const builtinTemplates: Template[] = [
  { key: 'portrait', name: '人像写真', cover: 'portrait', tags: ['人像'],
    content: '{人物}的半身人像，{服装}，站在{场景}，柔和窗光从侧面打来，85mm 镜头，浅景深，皮肤质感细腻，电影感调色' },
  { key: 'product', name: '产品主图', cover: 'product', tags: ['电商', '产品'],
    content: '{产品}的商业产品摄影，放置在{台面材质}台面上，{背景色}纯色背景，影棚柔光，细腻反射与阴影，居中构图，留白充足，高清细节' },
  { key: 'poster', name: '活动海报', cover: 'poster', tags: ['海报', '设计'],
    content: '{主题}主题海报，主视觉为{主视觉}，大标题文字「{标题}」，{风格}风格，层次分明的版式，强烈的视觉冲击力，精致排版' },
  { key: 'illustration', name: '叙事插画', cover: 'illustration', tags: ['插画'],
    content: '{角色}在{场景}中{动作}，{风格}插画风格，温暖的色调，丰富的环境细节，故事感强' },
  { key: 'avatar', name: '个性头像', cover: 'avatar', tags: ['头像'],
    content: '{角色}的头像，正面肩部以上，{风格}风格，简洁纯色背景，表情{表情}，线条干净，适合做社交头像' },
  { key: 'wallpaper', name: '手机壁纸', cover: 'wallpaper', tags: ['壁纸'],
    content: '{场景}的竖版手机壁纸，{时间}，{色调}色调，画面上方留出时钟空间，细节丰富，氛围感强' },
  { key: 'logo', name: '品牌标志', cover: 'logo', tags: ['Logo', '设计'],
    content: '为「{品牌名}」设计的极简标志，图形元素取自{元素}，扁平矢量风格，{颜色}主色，白色背景，居中，干净利落' },
  { key: 'food', name: '美食摄影', cover: 'food', tags: ['美食'],
    content: '一份{菜品}，俯拍平铺构图，{餐具}餐具，自然光，食材新鲜有光泽，背景是{桌面}桌面，杂志美食摄影' },
  { key: 'interior', name: '室内空间', cover: 'interior', tags: ['空间', '设计'],
    content: '{风格}风格的{空间}室内设计，大面积落地窗，午后阳光，{材质}材质点缀，广角镜头，建筑摄影' },
  { key: 'character', name: '角色设定', cover: 'character', tags: ['角色', '游戏'],
    content: '{角色}的角色设定图，正面、侧面、背面三视图，{服装}，{风格}风格，纯白背景，线条清晰' },
]

export function extractVars(text: string): string[] {
  const out: string[] = []
  const re = /\{([^{}\s]{1,16})\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export function fillVars(text: string, vars: Record<string, string>) {
  return text.replace(/\{([^{}\s]{1,16})\}/g, (all, k) => (vars[k] && vars[k].trim() ? vars[k].trim() : all))
}
