import TeacherApp from './teacher/TeacherApp.jsx';
import { usePath } from './lib/navigation.jsx';

export default function App() {
  const path = usePath();
  return <TeacherApp path={path} />;
}
