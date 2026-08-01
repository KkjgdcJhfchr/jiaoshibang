import AdminApp from './admin/AdminApp.jsx';
import TeacherApp from './teacher/TeacherApp.jsx';
import { usePath } from './lib/navigation.jsx';

export default function App() {
  const path = usePath();
  return path.startsWith('/admin') ? <AdminApp path={path} /> : <TeacherApp path={path} />;
}
