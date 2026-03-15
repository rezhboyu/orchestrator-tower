import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MosaicArea } from './components/MosaicArea';

function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <MosaicArea />
      </div>
    </div>
  );
}

export default App;
