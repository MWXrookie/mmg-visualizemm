import React, { useRef, useState } from 'react'
import { IconStar } from '../components/Icons.jsx'
import { loadFavorites, saveFavorites } from '../store.js'

const CARDS = [
  {
    id: 'purchase-variables', level: '初中', title: '变量与单位', topic: '描述数量',
    definition: '变量是在不同情况下可以取不同数值的量。说清变量的含义和单位，才能知道这些数值在描述什么。',
    applications: '用「路程」和「时间」描述行程，用「体积」和「用时」描述用水。比较同一种量时，先使用相同单位和口径。',
    boundary: '单位相同也可能在说不同的事。单价和总价有关，但分别回答「每单位多少钱」和「一共花多少钱」。',
    example: '比较单价与总价',
    activity: '切换比较的量，看看排序为什么会变。',
    options: ['每斤单价', '20 斤的总价'],
    results: [
      { labels: ['甲', '乙'], values: [4, 3], unit: '元/斤', answer: '同一口径下，乙每斤少 1 元。' },
      { labels: ['甲', '乙'], values: [80, 90], unit: '元', answer: '考虑 30 元配送费后，甲少付 10 元。' },
    ],
    context: '以采购 20 斤为例。甲每斤 4 元，免配送费。乙每斤 3 元，配送费 30 元。',
  },
  {
    id: 'purchase-graph', level: '初中', title: '一次函数与图像交点', topic: '理解关系',
    definition: '一个量每增加 1，另一个量总增加同样多或减少同样多，这种关系可以用直线表示。两条线相交时，在同一个横坐标上对应的纵坐标相等。',
    applications: '每分钟匀速注水、按固定速度行驶、按固定单价计费，都可以在各自适用的范围内用直线描述。',
    boundary: '速度或单价分段变化时，要分段画图。图上的交点也要落在两个关系都适用的范围内，才有实际含义。',
    example: '同一个输入，两条直线',
    activity: '移动横坐标，比较两个标记点的高度。经过交点时，它们的高度相同。',
    control: { label: '采购量', unit: '斤', min: 10, max: 50, initial: 20 },
    context: '采购示例中，甲每斤 4 元，乙每斤 3 元另加 30 元配送费。在同一采购量下比较总价。',
  },
  {
    id: 'water-check', level: '初中', title: '估计值、实测值与误差', topic: '比较结果',
    definition: '估计值来自已有信息或规则，实测值来自测量。用估计值减去同一次的实测值，可以看出估高还是估低，差的绝对值表示偏差有多大。',
    applications: '这组概念也可用来比较预计与实际用时、估计与实测长度。比较时要说清测量对象和单位。',
    boundary: '误差能否接受取决于用途和测量精度。一条记录可以提示异常，多条记录能帮助判断偏差是否经常出现。',
    example: '用水估计与新观测',
    activity: '切换两天的记录，比较误差的方向和大小。',
    options: ['普通上课日', '举办活动日'],
    results: [
      { labels: ['估计', '实际'], values: [30, 32], unit: '升', answer: '估计比实测少 2 升，误差为 −2 升。' },
      { labels: ['估计', '实际'], values: [30, 51], unit: '升', answer: '估计比实测少 21 升，误差为 −21 升。' },
    ],
    context: '按旧记录估计每天用水 30 升。两条对照记录此前未用于估计。',
  },
  {
    id: 'budget-constraints', level: '高中', title: '约束与可行解', topic: '理解限制',
    definition: '约束是一个方案必须满足的条件。可行解同时满足所有约束；可行集是所有可行解的集合。',
    applications: '约束可以是金额上限、出行时间限制或材料用量下限，也可以要求数量取整数。',
    boundary: '所有条件同时满足才叫可行。多个方案都可行时，要另外说明按什么标准比较优劣。',
    example: '两个约束同时生效',
    activity: '拖动预算，观察哪些方案改变了可行状态，哪些仍受另一个条件限制。',
    control: { label: '预算', unit: '元', min: 90, max: 160, initial: 120 },
    context: '至少买到 30 份。三份报价的数量、总价均已确认。',
  },
  {
    id: 'tide-cycle', level: '高中', title: '周期和周期性', topic: '识别重复规律',
    definition: '一个规律每隔固定的间隔重复一次，就具有周期性。最小的正重复间隔叫周期。',
    applications: '钟摆的摆动、旋转物体的位置、潮高的起伏，都能帮助理解周期。读实际数据时，应比较多次相同的变化阶段。',
    boundary: '有起伏只说明数值在波动。判断周期要看相同的变化是否按大致相同的间隔重复。',
    example: '固定重复和不等间隔起伏',
    activity: '在两种曲线间切换，拖动标线比较同类峰值的间隔。',
    control: { label: '猜测的间隔', unit: '小时', min: 4, max: 12, initial: 6 },
    context: '这是简化的教学样本。圆点表示每隔 2 小时观测一次的潮高。',
  },
  {
    id: 'tide-check', level: '高中', title: '误差与阈值判断', topic: '理解预测边界',
    definition: '阈值是一条用来区分结果的界线。当预测值离阈值很近时，即使误差很小，实际结果也可能落到界线的另一侧。',
    applications: '水位是否达到警戒线、温度是否超出允许范围、交付是否赶上截止时间，都可以用阈值判断。',
    boundary: '既要看预测离阈值多远，也要看过去误差有多大。临近阈值时，可以增加观测或明确说明判断有不确定性。',
    example: '同样大小的误差，不同的判断',
    activity: '切换两个时刻，观察预测和实测分别位于界线的哪一侧。',
    options: ['时刻一', '时刻二'],
    results: [
      { labels: ['预测', '观测'], values: [2.4, 2.2], unit: '米', threshold: 2, answer: '两者均达到题设的 2 米。' },
      { labels: ['预测', '观测'], values: [2.1, 1.9], unit: '米', threshold: 2, answer: '预测达标，实测未达标。' },
    ],
    context: '以水位为例，界线设为 2 米。两次预测都比实测高 0.2 米。',
  },
]

function Comparison({ result, referenceMax }) {
  const { labels, values, unit, answer, threshold } = result
  const max = Math.max(referenceMax, threshold ?? 0)
  return <div className="secondary-comparison">
    {labels.map((label, index) => (
      <div key={label}>
        <span>{label} <b>{values[index]} {unit}</b></span>
        <div className="secondary-meter" aria-hidden="true">
          <i style={{ width: values[index] / max * 100 + '%' }} />
          {threshold && <em style={{ left: threshold / max * 100 + '%' }} />}
        </div>
      </div>
    ))}
    <p role="status">{answer}</p>
  </div>
}

function PurchaseGraph({ quantity }) {
  const x = (amount) => 42 + amount * 5.5
  const y = (price) => 182 - price * 0.57
  const quotes = [4 * quantity, 3 * quantity + 30]
  return <>
    <svg viewBox="0 0 360 222" className="demo-svg" role="img"
      aria-label={'采购 ' + quantity + ' 斤，甲 ' + quotes[0] + ' 元，乙 ' + quotes[1] + ' 元'}>
      <path d="M 42 32 V 182 H 332" className="kc-plot-axis" />
      <text x="43" y="22" className="kc-plot-label">总价 / 元</text>
      <text x="332" y="216" textAnchor="end" className="kc-plot-label">采购量 / 斤</text>
      {[0, 10, 20, 30, 40, 50].map((amount) => <text key={amount} x={x(amount)} y="200" textAnchor="middle" className="kc-plot-label">{amount}</text>)}
      {[0, 100, 200].map((price) => <text key={price} x="35" y={y(price) + 4} textAnchor="end" className="kc-plot-label">{price}</text>)}
      <line x1={x(0)} y1={y(0)} x2={x(50)} y2={y(200)} className="kc-plot-goal" />
      <line x1={x(0)} y1={y(30)} x2={x(50)} y2={y(180)} className="kc-plot-series" />
      <line x1={x(quantity)} y1="42" x2={x(quantity)} y2="182" className="kc-plot-guide" />
      <circle cx={x(quantity)} cy={y(quotes[0])} r="5" className="kc-plot-point" />
      <rect x={x(quantity) - 4} y={y(quotes[1]) - 4} width="8" height="8" className="kc-plot-hollow" />
      <text x="323" y={y(200) - 5} className="kc-plot-label">甲</text>
      <text x="323" y={y(180) + 8} className="kc-plot-label">乙</text>
    </svg>
    <p className="demo-note" role="status">买 {quantity} 斤，甲 {quotes[0]} 元，乙 {quotes[1]} 元。{quotes[0] === quotes[1] ? '两家总价相同。' : quotes[0] < quotes[1] ? '甲总价更低。' : '乙总价更低。'}</p>
  </>
}

function BudgetComparison({ budget }) {
  const plans = [
    { name: '甲', quantity: 26, price: 95 },
    { name: '乙', quantity: 30, price: 110 },
    { name: '丙', quantity: 36, price: 135 },
  ]
  return <div className="secondary-comparison">
    {plans.map(({ name, quantity, price }) => {
      const conditions = [quantity >= 30, price <= budget]
      return <div key={name}>
        <span>{name} · {quantity} 份 · {price} 元 <b>{conditions.every(Boolean) ? '可行' : !conditions[0] ? '数量不足' : '超预算'}</b></span>
        <div className="secondary-meter" aria-hidden="true"><i style={{ width: price / 160 * 100 + '%' }} /><em style={{ left: budget / 160 * 100 + '%' }} /></div>
      </div>
    })}
    <p className="demo-note" role="status">预算 {budget} 元。竖线表示预算上限，数量至少为 30 的方案才可行。</p>
  </div>
}

function PeriodGraph({ interval }) {
  const [regular, setRegular] = useState(true)
  const heights = regular ? [1.6, 2.2, 2.7, 2.2, 1.6, 2.2, 2.7, 2.2, 1.6] : [1.6, 2.2, 2.7, 2.2, 2.6, 2.0, 2.3, 2.7, 1.6]
  const peaks = regular ? '峰值在第 4 和第 12 小时' : '峰值在第 4、8 和 14 小时'
  const x = (hour) => 36 + hour * 18
  const y = (height) => 164 - (height - 1) * 73
  return <>
    <div className="demo-controls" role="group" aria-label="选择变化规律">
      <button type="button" className={'btn btn-sm ' + (regular ? 'btn-primary' : 'btn-ghost')}
        aria-pressed={regular} onClick={() => setRegular(true)}>规则重复</button>
      <button type="button" className={'btn btn-sm ' + (!regular ? 'btn-primary' : 'btn-ghost')}
        aria-pressed={!regular} onClick={() => setRegular(false)}>不等间隔起伏</button>
    </div>
    <svg viewBox="0 0 360 208" className="demo-svg" role="img"
      aria-label={'模拟水位折线，' + peaks + '。标线相隔 ' + interval + ' 小时。'}>
      <path d="M 36 24 V 164 H 330" className="kc-plot-axis" />
      <text x="36" y="17" className="kc-plot-label">水位 / 米</text>
      <text x="330" y="202" textAnchor="end" className="kc-plot-label">时间 / 小时</text>
      {[1, 2, 3].map((height) => <text key={height} x="30" y={y(height) + 4} textAnchor="end" className="kc-plot-label">{height}</text>)}
      <polyline points={heights.map((height, index) => x(index * 2) + ',' + y(height)).join(' ')} className="kc-plot-goal" />
      {heights.map((height, index) => <g key={index}>
        <circle cx={x(index * 2)} cy={y(height)} r="4" className="kc-plot-point" />
        <text x={x(index * 2)} y="185" textAnchor="middle" className="kc-plot-label">{index * 2}</text>
      </g>)}
      {[4, 4 + interval].map((time) => <line key={time} x1={x(time)} x2={x(time)} y1="24" y2="164" className="kc-plot-guide" />)}
    </svg>
    <p className="demo-note" role="status">标线相隔 {interval} 小时。{regular
      ? interval === 8 ? '两条标线对齐相邻的两个观测峰。' : '第二条标线尚未对齐下一个观测峰。'
      : '相邻峰分别相隔 4 小时和 6 小时，这段数据不足以支持固定周期。'}</p>
  </>
}

function CardExample({ card }) {
  const [option, setOption] = useState(0)
  const [value, setValue] = useState(card.control?.initial)
  const { control } = card
  const result = card.results?.[option]
  const referenceMax = result ? Math.max(1, ...card.results.filter((item) => item.unit === result.unit).flatMap((item) => item.values)) : null
  return <div className="demo secondary-demo">
    {card.options && <>
      <div className="demo-controls" role="group" aria-label={card.activity}>
        {card.options.map((label, index) => (
          <button key={label} type="button" aria-pressed={option === index}
            className={'btn btn-sm ' + (option === index ? 'btn-primary' : 'btn-ghost')} onClick={() => setOption(index)}>{label}</button>
        ))}
      </div>
      <Comparison result={result} referenceMax={referenceMax} />
    </>}
    {control && <div className="demo-controls">
      <label>{control.label} <input type="range" min={control.min} max={control.max} value={value} onChange={(event) => setValue(+event.target.value)} /><b>{value} {control.unit}</b></label>
    </div>}
    {card.id === 'purchase-graph' && <PurchaseGraph quantity={value} />}
    {card.id === 'budget-constraints' && <BudgetComparison budget={value} />}
    {card.id === 'tide-cycle' && <PeriodGraph interval={value} />}
  </div>
}

export default function SecondaryCards() {
  const [level, setLevel] = useState('初中')
  const [selected, setSelected] = useState(null)
  const [favorites, setFavorites] = useState(() => loadFavorites('secondary'))
  const cardTitle = useRef(null)
  const lastButton = useRef(null)
  const card = CARDS.find(({ id }) => id === selected)
  const visible = CARDS.filter((entry) => level === '收藏' ? favorites.includes(entry.id) : entry.level === level)

  function returnToList() {
    setSelected(null)
    requestAnimationFrame(() => document.getElementById(lastButton.current)?.focus())
  }

  function toggleFavorite() {
    const next = favorites.includes(selected) ? favorites.filter((id) => id !== selected) : [...favorites, selected]
    setFavorites(next)
    saveFavorites(next, 'secondary')
  }

  return (
    <section className="secondary-library" aria-labelledby="secondary-library-title">
      <div className="secondary-library-heading">
        <h2 id="secondary-library-title">中学建模知识卡</h2>
        <p>理解建模里常用的概念，再用互动图观察它们。</p>
      </div>
      <div className="kl-scopes" role="group" aria-label="选择学段">
        {['初中', '高中', '收藏'].map((group) => (
          <button key={group} type="button" aria-pressed={level === group} onClick={() => { setLevel(group); setSelected(null) }}>{group}</button>
        ))}
      </div>
      {card ? <article className="secondary-reader" key={card.id}>
        <div className="secondary-reader-actions">
          <button type="button" className="btn btn-ghost" onClick={returnToList}>← 返回卡片</button>
          <button type="button" className="btn btn-ghost" aria-pressed={favorites.includes(selected)} onClick={toggleFavorite}>
            <IconStar size={16} filled={favorites.includes(selected)} /> {favorites.includes(selected) ? '已收藏' : '收藏卡片'}
          </button>
        </div>
        <p className="secondary-topic">{card.level} · {card.topic}</p>
        <h3 ref={cardTitle} tabIndex={-1}>{card.title}</h3>
        <p className="secondary-definition">{card.definition}</p>
        <section className="secondary-section">
          <h4>在哪里会用到</h4>
          <p>{card.applications}</p>
        </section>
        <section className="secondary-section secondary-boundary">
          <h4>容易混淆的地方</h4>
          <p>{card.boundary}</p>
        </section>
        <section className="secondary-section">
          <h4>互动示例 · {card.example}</h4>
          <p>{card.context}</p>
          <p>{card.activity}</p>
          <CardExample card={card} />
        </section>
      </article> : visible.length > 0 ? <div className="secondary-card-list">
        {visible.map((entry) => (
          <button key={entry.id} id={'secondary-card-' + entry.id} type="button" className="kl-entry"
            onClick={(event) => {
              lastButton.current = event.currentTarget.id
              setSelected(entry.id)
              requestAnimationFrame(() => cardTitle.current?.focus())
            }}>
            <span><small>{entry.topic}</small><strong>{entry.title}</strong><span className="kl-entry-summary">{entry.definition}</span></span>
          </button>
        ))}
      </div> : <p className="kl-empty">还没有收藏。打开一张卡片，即可收藏。</p>}
    </section>
  )
}
