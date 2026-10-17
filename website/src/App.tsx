import { useEffect } from 'react';
import { Route, Routes, useLocation, type Location } from 'react-router-dom';
import { AccessoryDetailModal } from './components/accessories/AccessoryDetailModal';
import { FrameDetailModal } from './components/frames/FrameDetailModal';
import { Footer } from './components/layout/Footer';
import { Navbar } from './components/layout/Navbar';
import { useSiteInfo } from './hooks/useSiteInfo';
import { HomePage } from './pages/HomePage';

interface LocationState {
  background?: Location;
}

function App() {
  const { siteInfo } = useSiteInfo();
  const location = useLocation();
  const backgroundLocation = (location.state as LocationState | null)?.background;

  useEffect(() => {
    if (siteInfo) document.title = siteInfo.name;
  }, [siteInfo]);

  return (
    <div className="min-h-screen bg-ivory">
      <Navbar storeName={siteInfo?.name ?? ''} />
      <main>
        {/* Registered here too (not just in the overlay below) so a direct link or a page refresh
            on /frames/:id or /accessories/:id still renders something — with no background state,
            backgroundLocation is undefined and this tree renders the real current location. */}
        <Routes location={backgroundLocation ?? location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/frames/:id" element={<FrameDetailModal />} />
          <Route path="/accessories/:id" element={<AccessoryDetailModal />} />
        </Routes>
      </main>
      <Footer siteInfo={siteInfo} />

      {/* With a background location set (a card was clicked in-app), the grid above stays
          rendered exactly as it was and the detail route renders as an overlay on top of it. */}
      {backgroundLocation && (
        <Routes>
          <Route path="/frames/:id" element={<FrameDetailModal />} />
          <Route path="/accessories/:id" element={<AccessoryDetailModal />} />
        </Routes>
      )}
    </div>
  );
}

export default App;
