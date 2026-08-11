import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { setAuthReturnTo } from '../utils/authReturn';

// Legacy URL — keep FredDuel post-setup return, send users to generic setup.
function FredDuelSetupPage() {
  useEffect(() => {
    setAuthReturnTo('/FredDuel');
  }, []);
  return <Navigate to="/account/setup" replace />;
}

export default FredDuelSetupPage;
