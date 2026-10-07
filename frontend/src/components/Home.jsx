import { useAuthStore } from '../store/authStore.js'
import { Landing } from './home/Landing.jsx'
import { Welcome } from './home/Welcome.jsx'

// signed out: the product landing page. Signed in: a personal start page
// with what needs attention and shortcuts for the person's role
export const Home = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return isAuthenticated ? <Welcome /> : <Landing />
}
