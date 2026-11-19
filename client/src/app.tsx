import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import NotFound from "./pages/NotFound/NotFound";
import AuditPage from "./pages/AuditPage/AuditPage";
import AuditResultPage from "./pages/AuditResultPage/AuditResultPage";
import AuditQuickPage from "./pages/AuditQuickPage/AuditQuickPage";
import GeneratePage from "./pages/GeneratePage/GeneratePage";
import VerifyPage from "./pages/VerifyPage/VerifyPage";

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/audit" replace />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/audit/result/:recordId" element={<AuditResultPage />} />
        <Route path="/audit-quick/:recordId" element={<AuditQuickPage />} />
        <Route path="/generate" element={<GeneratePage />} />
        <Route path="/verify" element={<VerifyPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
