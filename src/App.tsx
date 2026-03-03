import { useState } from 'react';
import type { Floor } from './types';
import { useApp } from './context/AppContext';
import Layout from './components/Layout';
import StaffPage from './pages/StaffPage';
import SettingsPage from './pages/SettingsPage';
import PairPage from './pages/PairPage';
import ShiftTablePage from './pages/ShiftTablePage';

export default function App() {
  const [page, setPage] = useState('staff');
  const { state, dispatch } = useApp();

  const setFloor = (f: Floor) => dispatch({ type: 'SET_FLOOR', floor: f });
  const setMonth = (y: number, m: number) => dispatch({ type: 'SET_MONTH', year: y, month: m });

  const pageComponent = () => {
    switch (page) {
      case 'staff': return <StaffPage />;
      case 'settings': return <SettingsPage />;
      case 'pairs': return <PairPage />;
      case 'shift': return <ShiftTablePage />;
      default: return <StaffPage />;
    }
  };

  return (
    <Layout
      currentPage={page}
      onPageChange={setPage}
      currentFloor={state.currentFloor}
      onFloorChange={setFloor}
      currentYear={state.currentYear}
      currentMonth={state.currentMonth}
      onMonthChange={setMonth}
    >
      {pageComponent()}
    </Layout>
  );
}
