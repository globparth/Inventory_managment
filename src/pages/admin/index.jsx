import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../auth.jsx'
import { Banner, Spinner } from '../../ui.jsx'
import Dashboard from './Dashboard.jsx'
import Assign from './Assign.jsx'
import Products from './Products.jsx'
import Import from './Import.jsx'
import Labels from './Labels.jsx'
import Log from './Log.jsx'
import Backup from './Backup.jsx'

export default function Admin() {
  const { loading, session, isAdmin } = useAuth()
  if (loading) return <Spinner />
  if (!session) {
    return <main className="page"><Banner kind="warn">Sign in with an admin account to open this area. <Link to="/login?next=/admin">Sign in</Link></Banner></main>
  }
  if (!isAdmin) {
    return <main className="page"><Banner kind="error">This area is for admins only.</Banner></main>
  }
  const tab = ({ isActive }) => (isActive ? 'active' : undefined)
  return (
    <>
      <nav className="tabs" aria-label="Admin sections">
        <NavLink to="/admin" end className={tab}>Dashboard</NavLink>
        <NavLink to="/admin/assign" className={tab}>Assign product</NavLink>
        <NavLink to="/admin/products" className={tab}>Products</NavLink>
        <NavLink to="/admin/import" className={tab}>Import</NavLink>
        <NavLink to="/admin/labels" className={tab}>QR labels</NavLink>
        <NavLink to="/admin/log" className={tab}>Sample log</NavLink>
        <NavLink to="/admin/backup" className={tab}>Backup</NavLink>
      </nav>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="assign" element={<Assign />} />
        <Route path="products" element={<Products />} />
        <Route path="import" element={<Import />} />
        <Route path="labels" element={<Labels />} />
        <Route path="log" element={<Log />} />
        <Route path="backup" element={<Backup />} />
      </Routes>
    </>
  )
}
