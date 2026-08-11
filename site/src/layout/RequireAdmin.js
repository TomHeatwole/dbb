import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from '../hooks/useAuthUser';
import { isAdminUser } from '../utils/adminAccounts';

function RequireAdmin({ children }) {
  const { user, loading } = useAuthUser();
  if (loading) return null;
  if (!isAdminUser(user)) return <Navigate to="/home/" replace />;
  return children;
}

export default RequireAdmin;
