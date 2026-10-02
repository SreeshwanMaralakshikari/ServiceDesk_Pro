// the one place the application's time zone is declared. IST has a fixed
// +05:30 offset and no DST, which businessHours.js relies on. Pass
// APP_TIME_ZONE as `timezone` to Mongo date aggregations so day boundaries
// are IST days, not UTC days
export const APP_TIME_ZONE = 'Asia/Kolkata'
export const APP_UTC_OFFSET_MINUTES = 330
