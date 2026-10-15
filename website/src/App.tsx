import { useEffect } from 'react';
import { Footer } from './components/layout/Footer';
import { Navbar } from './components/layout/Navbar';
import { useSiteInfo } from './hooks/useSiteInfo';
import { HomePage } from './pages/HomePage';

function App() {
  const { siteInfo } = useSiteInfo();

  useEffect(() => {
    if (siteInfo) document.title = siteInfo.name;
  }, [siteInfo]);

  return (
    <div className="min-h-screen bg-ivory">
      <Navbar storeName={siteInfo?.name ?? ''} />
      <main>
        <HomePage />
      </main>
      <Footer siteInfo={siteInfo} />
    </div>
  );
}

export default App;
