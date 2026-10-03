import { BarList } from './BarList.jsx'

// CSAT distribution, 5 stars first. Reuses the bar list so the look stays the same.
export const RatingBars = ({ distribution }) => (
  <BarList
    items={[...(distribution ?? [])].sort((a, b) => b.rating - a.rating).map((d) => ({
      label: `${d.rating} ${d.rating === 1 ? 'star' : 'stars'}`,
      value: d.count,
      hint: `${d.count} rating${d.count === 1 ? '' : 's'}`,
    }))}
    empty="No ratings in this period"
  />
)
