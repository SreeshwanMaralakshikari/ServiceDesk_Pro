// one rule for every NEW password (register, admin create, change password).
// Existing accounts keep their old passwords until they change them. 72 is
// bcrypt's limit: anything longer would be silently cut off
export const MIN_NEW_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 72

// returns an error message, or null when the password is acceptable
export const passwordProblem = (password) => {
  if (typeof password !== 'string') return 'password must be text'
  if (password.length < MIN_NEW_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `password must be ${MIN_NEW_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`
  }
  return null
}
