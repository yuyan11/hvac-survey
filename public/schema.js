/* 问卷结构定义（入职 + 技能考察合并为一份连续表单）
 * 字段通用属性：
 *   name      字段名（唯一）
 *   label     题目标题
 *   type      text | textarea | number | tel | date | radio | checkbox | select | scale | rows
 *   required  是否必填
 *   options   选项（radio/checkbox/select）
 *   hint      题目下方灰字说明
 *   unit      数字后缀单位
 *   showIf    条件显示，返回 true 才出现该题或该组
 *   cols      rows 类型的列定义
 *   min/max   rows 最少/最多行数
 */

/* ============ 入职登记部分 ============ */
const PART_ENTRY = [
  {
    id: 'base',
    title: '基本信息',
    fields: [
      { name: 'name', label: '姓名', type: 'text', required: true },
      { name: 'gender', label: '性别', type: 'radio', required: true, options: ['男', '女'] },
      { name: 'phone', label: '本人手机号', type: 'tel', required: true },
      { name: 'wechat', label: '微信号 / 备用联系方式', type: 'text' },
      {
        name: 'idcard', label: '身份证号', type: 'text', required: true,
        hint: '出生日期与年龄由身份证号自动识别，无需另填；号码用于实名登记、保险购买与工资发放',
      },
      {
        name: 'idcard_front', label: '身份证 · 人像面', type: 'photo', side: 'front', required: true,
        hint: '可拍照或从相册选择，自动压缩后上传，仅管理员可见',
      },
      {
        name: 'idcard_back', label: '身份证 · 国徽面', type: 'photo', side: 'back',
        hint: '选填',
      },
      { name: 'live_addr', label: '现居住地址', type: 'text', required: true },
      { name: 'is_local', label: '是否在本地长期居住', type: 'radio', options: ['是', '否，可随项目流动'] },
    ],
  },
  {
    id: 'apply',
    title: '应聘信息',
    fields: [
      {
        name: 'position', label: '应聘岗位', type: 'checkbox', required: true,
        options: ['空调安装工', '多联机安装工', '水机/末端安装工', '风管制作安装工', '铜焊/电焊工', '电工', '制冷工/维修工', '防排烟安装工', '班组长/带班', '项目经理', '学徒工', '其他'],
      },
      { name: 'position_other', label: '其他岗位请注明', type: 'text', showIf: v => (v.position || []).includes('其他') },
      {
        name: 'work_years', label: '本行业从业年限', type: 'radio', required: true,
        options: ['1年以内', '1-3年', '3-5年', '5-10年', '10年以上'],
      },
      {
        name: 'emp_type', label: '期望用工形式', type: 'radio', required: true,
        options: ['全职（长期）', '兼职', '临时工/点工', '包工（自带队伍）'],
      },
      { name: 'salary_exp', label: '期望薪资', type: 'text', required: true, placeholder: '如 350元/天 或 9000元/月' },
      {
        name: 'salary_cycle', label: '期望结算方式', type: 'radio',
        options: ['日结', '周结', '月结', '按项目节点结算', '完工结算'],
      },
      { name: 'onboard_date', label: '可到岗时间', type: 'text', required: true, placeholder: '如 随时 / 2026-10-08' },
      {
        name: 'source', label: '信息来源', type: 'radio',
        options: ['熟人介绍', '招聘平台', '微信群/朋友圈', '门店张贴', '其他'],
      },
    ],
  },
  {
    id: 'cert',
    title: '学历与证书',
    fields: [
      {
        name: 'edu', label: '最高学历', type: 'radio',
        options: ['小学', '初中', '中专/技校', '高中', '大专', '本科及以上'],
      },
      { name: 'school', label: '毕业院校 / 专业', type: 'text' },
      {
        name: 'certs', label: '持有证书（多选，无则留空）', type: 'checkbox',
        options: [
          '低压电工证', '高压电工证', '焊工证（熔化焊接与热切割）', '高处作业证',
          '制冷空调系统安装维修证', '制冷工证', '空调安装维修证', '消防设施操作员证',
          '起重/吊装作业证', '安全员C证', '特种设备作业人员证', '驾驶证',
        ],
      },
      { name: 'drive_type', label: '驾驶证准驾车型', type: 'text', showIf: v => (v.certs || []).includes('驾驶证'), placeholder: '如 C1 / B2' },
      { name: 'cert_valid', label: '证书有效期至（主要证书）', type: 'text', placeholder: '如 2028-06-30' },
    ],
  },
  {
    id: 'exp',
    title: '工作经历（填得越详细越好）',
    hint: '按项目逐条填写：哪家单位、哪个项目、什么时间、具体做了什么。条数不限，最多可填 15 条',
    fields: [
      {
        name: 'exp_rows', label: '项目经历', type: 'rows', min: 3, max: 15, required: true,
        cols: [
          { name: 'company', label: '公司 / 单位名称', type: 'text' },
          { name: 'project', label: '项目名称及地点', type: 'text' },
          { name: 'content', label: '做了什么（机型 / 规模 / 工艺）', type: 'text' },
          { name: 'period', label: '起止时间', type: 'text' },
          { name: 'role', label: '担任岗位', type: 'text' },
        ],
      },
      { name: 'max_project', label: '做过的最大项目规模', type: 'text', placeholder: '如：某商场 3 万㎡，多联机 120 台内机' },
    ],
  },
  {
    id: 'health',
    title: '身体状况与作业条件',
    hint: '空调安装涉及高空、用电、动火作业，以下信息关系到人身安全，请如实填写',
    fields: [
      {
        name: 'disease', label: '是否有以下疾病或身体情况（多选，无则留空）', type: 'checkbox',
        options: ['高血压', '心脏病', '癫痫/晕厥史', '恐高症', '色盲/色弱', '腰椎/颈椎疾病', '听力障碍', '传染性疾病', '均无'],
      },
      { name: 'can_high', label: '能否登高作业（2 米及以上）', type: 'radio', required: true, options: ['可以', '不可以', '有高处作业证，可长期高空'] },
      {
        name: 'high_type', label: '可适应的高空作业形式', type: 'checkbox',
        options: ['人字梯', '门式脚手架', '吊篮', '安全带悬挂作业', '屋面/设备平台', '都不能'],
        showIf: v => v.can_high && v.can_high !== '不可以',
      },
      { name: 'can_travel', label: '能否接受外地项目出差/驻场', type: 'radio', required: true, options: ['可以，全国', '可以，省内', '仅本市', '不接受'] },
      { name: 'can_overtime', label: '能否接受加班/夜间施工', type: 'radio', options: ['可以', '偶尔可以', '不接受'] },
      { name: 'smoke_drink', label: '吸烟饮酒情况', type: 'radio', options: ['不吸烟不饮酒', '吸烟', '饮酒', '吸烟且饮酒'] },
    ],
  },
  {
    id: 'tool',
    title: '工具与交通',
    fields: [
      {
        name: 'tools', label: '自有工具设备（多选，无则留空）', type: 'checkbox',
        options: ['真空泵', '氮气瓶及减压阀', '双表阀/压力表', '割管器/扩口器/弯管器', '电子检漏仪', '冲击钻/电锤', '水钻', '电焊机', '氩弧焊机', '套丝机', '角磨机', '激光水平仪', '钳形万用表', '全套手工具'],
      },
      { name: 'has_car', label: '是否有交通工具', type: 'radio', options: ['无', '电动车', '摩托车', '轿车', '面包车/货车', '可租用到货车'] },
    ],
  },
  {
    id: 'pay',
    title: '工资发放与紧急联系人',
    fields: [
      { name: 'emergency_name', label: '紧急联系人姓名', type: 'text', required: true },
      { name: 'emergency_rel', label: '与本人关系', type: 'text', required: true },
      { name: 'emergency_phone', label: '紧急联系人电话', type: 'tel', required: true },
      { name: 'bank_name', label: '工资卡开户行', type: 'text', hint: '用于发放工资，可稍后补交' },
      { name: 'bank_account', label: '工资卡卡号', type: 'text' },
      { name: 'need_dorm', label: '是否需要提供住宿', type: 'radio', options: ['需要', '不需要', '需要住宿补贴'] },
    ],
  },
  {
    id: 'other',
    title: '其他事项',
    fields: [
      {
        name: 'no_record', label: '是否有违法犯罪记录', type: 'radio', required: true,
        options: ['无', '有（需说明）'],
        hint: '涉及进场报备，多数工地实名制系统会核验',
      },
      { name: 'record_detail', label: '如有请说明', type: 'textarea', showIf: v => v.no_record === '有（需说明）' },
      {
        name: 'labor_rel', label: '是否与其他单位仍存在未解除的劳动关系', type: 'radio', required: true,
        options: ['否', '是'],
      },
      { name: 'remark_entry', label: '补充说明 / 想让我们了解的内容', type: 'textarea' },
    ],
  },
];

/* ============ 技能考察部分 ============ */
const PART_SKILL = [
  {
    id: 'team',
    title: '队伍与作业能力',
    hint: '以下为中央空调安装技能考察，个人施工按 1 人队伍填写即可',
    fields: [
      { name: 'team_name', label: '队伍名称 / 负责人（个人可填本人姓名）', type: 'text', required: true },
      { name: 'contact', label: '联系电话', type: 'tel', required: true },
      { name: 'team_size', label: '队伍总人数', type: 'number', required: true, unit: '人' },
      {
        name: 'team_struct', label: '人员构成', type: 'rows', min: 1, max: 4,
        cols: [
          { name: 'role', label: '工种/角色（师傅、中工、小工等）', type: 'text' },
          { name: 'count', label: '人数', type: 'number' },
          { name: 'years', label: '平均从业年限', type: 'text' },
        ],
      },
      { name: 'site_parallel', label: '可同时开工的工地数量', type: 'number', unit: '个' },
      { name: 'base_city', label: '常驻城市', type: 'text' },
      { name: 'service_area', label: '可承接区域', type: 'text', placeholder: '如 华东地区 / 全省 / 本市' },
      {
        name: 'has_company', label: '是否有公司主体、能否开票', type: 'radio', required: true,
        options: ['有公司，可开专票', '有公司，仅普票', '个体户/可代开', '个人，无法开票'],
      },
      {
        name: 'insurance', label: '保险情况', type: 'checkbox', required: true,
        options: ['全员意外险', '雇主责任险', '工伤保险', '建筑施工人员团体险', '均未购买'],
        hint: '无保险的队伍多数工地不予进场',
      },
    ],
  },

  /* ---- 分支源 ---- */
  {
    id: 'types',
    title: '可承接机型（决定后续题目）',
    fields: [
      {
        name: 'sys_types', label: '可承接的机型 / 系统（多选，必填）', type: 'checkbox', required: true,
        options: ['多联机（VRF / 一拖多）', '水机（冷水机组 + 风机盘管 / 水冷柜机）', '风管机 / 新风 / 中央空调末端', '消防防排烟', '机房精密空调', '冷库 / 冷链', '家用中央空调'],
      },
      {
        name: 'main_type', label: '其中最强的一项', type: 'radio',
        options: ['多联机（VRF / 一拖多）', '水机（冷水机组 + 风机盘管 / 水冷柜机）', '风管机 / 新风 / 中央空调末端', '消防防排烟', '机房精密空调', '冷库 / 冷链', '家用中央空调'],
        showIf: v => (v.sys_types || []).length > 1,
        hint: '选了多项时请标明主项，便于派单',
      },
    ],
  },

  /* ---- 分支 A：多联机 ---- */
  {
    id: 'vrf',
    title: '多联机（VRF）专项',
    showIf: v => (v.sys_types || []).includes('多联机（VRF / 一拖多）'),
    fields: [
      {
        name: 'vrf_brands', label: '安装过的品牌（多选）', type: 'checkbox', required: true,
        options: ['大金', '格力', '美的', '海尔', '海信/日立', '三菱电机', '东芝', '约克', '麦克维尔', '其他国产'],
      },
      { name: 'vrf_max_hp', label: '单项目最大规模（外机总匹数）', type: 'text', placeholder: '如 160HP' },
      { name: 'vrf_max_idu', label: '单项目最多内机台数', type: 'number', unit: '台' },
      {
        name: 'vrf_pipe', label: '铜管施工能力（多选）', type: 'checkbox',
        options: ['能独立按规范计算管径与分歧管选型', '能独立下料排布', '喇叭口制作规范（无偏心/裂纹）', '分歧管前后直管段符合要求', '铜管吹污/氮气置换保护焊接', '支架与固定规范（含抗震）'],
      },
      {
        name: 'vrf_pressure', label: '气密试验做法', type: 'textarea',
        placeholder: '请写：用何种气体、保压压力多少 MPa、保压多久、允许压降多少',
        hint: '例如：R410A 系统氮气保压 4.0MPa，24 小时压降不超过 0.02MPa',
      },
      {
        name: 'vrf_vacuum', label: '真空干燥做法', type: 'textarea',
        placeholder: '请写：真空泵排量、抽到多少 Pa/micron、保真空多久、如何判定合格',
      },
      { name: 'vrf_charge', label: '冷媒追加量如何确定', type: 'radio', options: ['按液管管径×长度查表计算', '按设备铭牌定量充注并用电子秤称重', '凭经验估计', '不清楚'] },
      { name: 'vrf_drain', label: '冷凝水管道做法', type: 'textarea', placeholder: '坡度、存水弯、排气口、保温、灌水试验' },
      { name: 'vrf_insul', label: '保温做法', type: 'textarea', placeholder: '橡塑管厚度、胶水涂刷、接口方向、外保护层' },
      { name: 'vrf_elec', label: '电气与通讯线做法', type: 'textarea', placeholder: '内外机电源是否独立回路、线径选型、通讯线屏蔽与接地' },
      {
        name: 'vrf_debug', label: '调试与故障处理能力（多选）', type: 'checkbox',
        options: ['能设置地址码/拨码', '会用厂家调试软件或手操器', '能做试运转与运转数据记录', '能排查通讯故障（如 U4 类）', '能排查高压/低压保护类故障', '能查漏并补焊补注冷媒', '能配合厂家做验收'],
      },
      { name: 'vrf_self', label: '多联机综合能力自评', type: 'scale' },
    ],
  },

  /* ---- 分支 B：水机 ---- */
  {
    id: 'water',
    title: '水机系统专项',
    showIf: v => (v.sys_types || []).includes('水机（冷水机组 + 风机盘管 / 水冷柜机）'),
    fields: [
      {
        name: 'w_unit_type', label: '安装/配合过的冷源类型（多选）', type: 'checkbox', required: true,
        options: ['螺杆式冷水机组', '离心式冷水机组', '涡旋/模块式冷水机组', '风冷模块机', '空气源热泵', '溴化锂吸收式机组', '水冷柜机', '地/水源热泵'],
      },
      { name: 'w_capacity', label: '做过的最大冷量', type: 'text', placeholder: '如 1200RT / 4200kW' },
      {
        name: 'w_pipe', label: '水管施工能力（多选）', type: 'checkbox',
        options: ['无缝钢管焊接', '镀锌钢管丝接', '沟槽（卡箍）连接', '法兰连接', 'PP-R / PE 热熔', '不锈钢管卡压/焊接', '能做管道支架与抗震支吊架'],
      },
      {
        name: 'w_accessory', label: '水系统附件安装经验（多选）', type: 'checkbox',
        options: ['定压补水装置 / 膨胀水箱', 'Y 型过滤器与排污阀', '电动二/三通阀与压差旁通', '软接与减震基础', '压力表、温度计、流量计', '水处理/加药装置', '板式换热器'],
      },
      { name: 'w_pump', label: '水泵选型与扬程估算能力', type: 'radio', options: ['能独立计算管路阻力并选型', '能按图纸选型', '只按图纸安装，不参与选型', '不熟悉'] },
      { name: 'w_test', label: '水压试验做法', type: 'textarea', placeholder: '强度试验压力取值、稳压时长、允许压降、严密性试验、冲洗排污' },
      { name: 'w_tower', label: '冷却塔安装经验', type: 'textarea', placeholder: '基础、配管、补水、风机接线、水处理；无经验写"无"' },
      { name: 'w_terminal', label: '末端设备安装做法', type: 'textarea', placeholder: '风机盘管/空调机组吊装减震、接水盘、软接、排气阀、回风箱、过滤段' },
      { name: 'w_insul', label: '水管与阀门保温做法', type: 'textarea', placeholder: '材料、厚度、阀门可拆卸保温、外护（铝皮/镀锌铁皮）' },
      { name: 'w_balance', label: '水力平衡调试能力', type: 'radio', options: ['能用平衡阀/流量计做系统平衡', '会配合调试单位', '仅做通水检查', '不熟悉'] },
      { name: 'w_antifreeze', label: '冬季防冻措施', type: 'textarea', placeholder: '泄水、乙二醇、电伴热、冬季值守等' },
      { name: 'w_self', label: '水机系统综合能力自评', type: 'scale' },
    ],
  },

  /* ---- 分支 C：风管 / 新风 ---- */
  {
    id: 'duct',
    title: '风管与末端专项',
    showIf: v => (v.sys_types || []).includes('风管机 / 新风 / 中央空调末端'),
    fields: [
      {
        name: 'd_material', label: '做过的风管材质（多选）', type: 'checkbox',
        options: ['镀锌钢板风管', '共板法兰（TDF）风管', '角钢法兰风管', '复合风管（酚醛/玻镁/聚氨酯）', '不锈钢风管', '玻纤风管', '软管/铝箔软管'],
      },
      { name: 'd_thick', label: '常用钢板厚度范围', type: 'text', placeholder: '如 0.5~1.2mm' },
      {
        name: 'd_skill', label: '制作安装能力（多选）', type: 'checkbox',
        options: ['能按图展开下料放样', '咬口机/折方机操作', '共板法兰成型', '角钢法兰制作与铆接', '风管加固（立筋/角钢/抱箍）', '能做漏光/漏风量检测'],
      },
      {
        name: 'd_part', label: '部件安装经验（多选）', type: 'checkbox',
        options: ['风量调节阀/对开多叶阀', '防火阀 70℃', '排烟防火阀 280℃', '消声器/静压箱', '散流器/百叶风口', '软接与减震吊架', '新风热回收机组'],
      },
      { name: 'd_insul', label: '风管保温做法', type: 'textarea', placeholder: '材料与厚度、内保温/外保温、法兰处处理' },
      { name: 'd_self', label: '风管专项能力自评', type: 'scale' },
    ],
  },

  /* ---- 分支 D：消防防排烟 ---- */
  {
    id: 'fire',
    title: '消防防排烟专项',
    showIf: v => (v.sys_types || []).includes('消防防排烟'),
    fields: [
      {
        name: 'f_scope', label: '做过的防排烟内容（多选）', type: 'checkbox', required: true,
        options: ['排烟风管制作安装', '正压送风系统', '补风系统', '排烟风机/送风机安装', '防火阀与排烟阀安装接线', '消防联动调试配合', '消防验收资料报验', '仅配合过，未独立施工'],
      },
      { name: 'f_thick', label: '排烟风管钢板厚度与做法', type: 'textarea', placeholder: '按 GB51251 高压系统要求，常用厚度与加固方式' },
      { name: 'f_valve', label: '阀门安装要点', type: 'textarea', placeholder: '70℃防火阀、280℃排烟防火阀安装位置、独立支吊架、接线与信号反馈' },
      { name: 'f_accept', label: '是否熟悉消防验收流程与资料', type: 'radio', options: ['熟悉，能独立报验', '做过部分资料', '只做安装，资料由总包负责', '不熟悉'] },
      {
        name: 'f_cert', label: '消防相关证书', type: 'checkbox',
        options: ['消防设施操作员证', '无相关证书', '其他'],
      },
      { name: 'f_self', label: '防排烟专项能力自评', type: 'scale' },
    ],
  },

  /* ---- 分支 E：机房精密空调 ---- */
  {
    id: 'idc',
    title: '机房精密空调专项',
    showIf: v => (v.sys_types || []).includes('机房精密空调'),
    fields: [
      {
        name: 'i_brands', label: '接触过的品牌', type: 'checkbox',
        options: ['维谛 Vertiv / 艾默生', '佳力图', '世图兹 Stulz', '约克', '美的/格力机房机', '其他'],
      },
      {
        name: 'i_skill', label: '具备能力（多选）', type: 'checkbox',
        options: ['室内机就位与减震', '室外机（冷凝机组）安装与管路', '上下水与加湿罐接管', '漏水报警绳敷设', '冷凝排水与防倒灌', 'RS485/SNMP 监控接入', '能配合机房带载测试'],
      },
      { name: 'i_self', label: '机房空调专项能力自评', type: 'scale' },
    ],
  },

  /* ---- 分支 F：冷库 ---- */
  {
    id: 'cold',
    title: '冷库 / 冷链专项',
    showIf: v => (v.sys_types || []).includes('冷库 / 冷链'),
    fields: [
      {
        name: 'c_skill', label: '具备能力（多选）', type: 'checkbox',
        options: ['库板拼装与密封', '机组安装（半封闭/螺杆/涡旋）', '冷风机/铝排蒸发器安装', '膨胀阀调节与过热度调试', '化霜系统（电热/水冲/热氟）', '低温保温与防潮隔汽层', '电控箱接线与温控调试'],
      },
      { name: 'c_temp', label: '做过的库温范围', type: 'text', placeholder: '如 -18℃ 冷冻库 / 0~5℃ 冷藏库' },
      { name: 'c_self', label: '冷库专项能力自评', type: 'scale' },
    ],
  },

  /* ---- 通用能力 ---- */
  {
    id: 'common',
    title: '通用技术能力',
    fields: [
      {
        name: 'drawing', label: '识图与深化能力', type: 'checkbox', required: true,
        options: ['能看懂蓝图/施工图纸', '会用 CAD 看图', '能现场放样下料', '能做深化设计与综合排布', '能绘制竣工图', '看图有困难'],
      },
      {
        name: 'weld', label: '焊接能力（多选，无则留空）', type: 'checkbox',
        options: ['铜管氧乙炔钎焊', '铜管磷铜/银钎料焊接', '电焊（手工电弧焊）', '氩弧焊', '会做氮气置换保护焊', '不会焊接'],
      },
      {
        name: 'high_work', label: '高处与吊装能力（多选）', type: 'checkbox',
        options: ['门式脚手架搭拆', '吊篮作业', '卷扬机/手拉葫芦吊装', '配合吊车吊装机组', '有限空间/设备机房作业', '均不具备'],
      },
      {
        name: 'safety', label: '安全与规范（多选）', type: 'checkbox',
        options: ['接受过三级安全教育', '会做安全技术交底', '熟悉动火审批流程', '了解 GB50243 通风与空调施工质量验收规范', '了解 GB50274 制冷设备安装规范', '了解 GB51251 防排烟标准', '均不了解'],
      },
      {
        name: 'docs', label: '工程资料能力（多选）', type: 'checkbox',
        options: ['隐蔽工程验收记录', '管道试压/冲洗记录', '漏光或漏风量检测记录', '风量与水力平衡调试记录', '材料合格证报验', '竣工图与结算资料', '不做资料'],
      },
    ],
  },

  /* ---- 工具设备 ---- */
  {
    id: 'tools',
    title: '设备配置',
    fields: [
      {
        name: 'equip', label: '自有设备（多选）', type: 'checkbox', required: true,
        options: [
          '真空泵（4L/s 以上）', '氮气瓶及减压阀（可到 4.0MPa）', '双表阀/压力表组', '电子秤（定量充注）',
          '割管器/扩口器/弯管器', '电子检漏仪', '电焊机', '氩弧焊机', '套丝机', '沟槽机',
          '咬口机/共板法兰机', '折方机', '水钻/电锤/冲击钻', '激光水平仪或投线仪',
          '风速仪/风量罩', '钳形表/兆欧表', '红外测温仪',
        ],
      },
      { name: 'equip_missing', label: '目前缺什么设备（如需我们提供或租赁）', type: 'textarea' },
    ],
  },

  /* ---- 业绩与商务 ---- */
  {
    id: 'biz',
    title: '业绩与商务条件',
    fields: [
      {
        name: 'projects', label: '近三年主要业绩（最多 5 个）', type: 'rows', min: 1, max: 5,
        cols: [
          { name: 'pname', label: '项目名称', type: 'text' },
          { name: 'pscale', label: '规模（面积/台数）', type: 'text' },
          { name: 'powner', label: '甲方/总包', type: 'text' },
          { name: 'ptime', label: '时间', type: 'text' },
        ],
      },
      {
        name: 'coop_mode', label: '可承接方式', type: 'checkbox', required: true,
        options: ['清包（只出人工）', '包工包辅料', '包工包料', '点工（按工日）', '整包（含资料与验收）'],
      },
      {
        name: 'quote_mode', label: '习惯报价方式', type: 'checkbox',
        options: ['按内机台数', '按建筑面积', '按工日', '按系统/按栋', '按工程量清单'],
      },
      { name: 'max_scale', label: '单次可承接的最大规模', type: 'text', placeholder: '如 2 万㎡ / 150 台内机' },
      { name: 'lead_time', label: '最快进场时间', type: 'text', placeholder: '如 3 天内 / 需提前 2 周' },
      { name: 'warranty', label: '可承诺质保期', type: 'text', placeholder: '如 安装完成后 24 个月' },
    ],
  },

  {
    id: 'extra',
    title: '自评与承诺',
    fields: [
      { name: 'self_level', label: '综合能力自评', type: 'scale', required: true },
      { name: 'remark', label: '补充说明（擅长/不接的活、特殊要求等）', type: 'textarea' },
      {
        name: 'declare', label: '本人承诺以上填写内容真实有效，如有虚假愿承担相应责任', type: 'radio', required: true,
        options: ['同意并确认'],
      },
    ],
  },
];

/* ============ 合并为一份连续表单 ============ */
const COMBINED = {
  id: 'combined',
  title: '入职与技能考察登记表',
  subtitle: '请一次性填完：前 8 部分为入职登记，之后为中央空调安装技能考察。带 * 为必填项，填得越详细越有利于评估',
  groups: PART_ENTRY.concat(PART_SKILL),
};

window.FORMS = [COMBINED];
