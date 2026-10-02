import { styles, flagColors } from '../../styles/common.js'

// the badge half of the Boolean flag rule: every Boolean field shows as one of these
export const FlagBadge = ({ on, onLabel = 'Yes', offLabel = 'No' }) => (
  <span className={`${styles.badge} ${on ? flagColors.on : flagColors.off}`}>{on ? onLabel : offLabel}</span>
)

export const ActiveBadge = ({ isActive }) => <FlagBadge on={isActive} onLabel="Active" offLabel="Inactive" />
