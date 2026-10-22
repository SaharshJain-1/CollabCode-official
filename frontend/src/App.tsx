import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Register from "./pages/Register";
import CodeEditor from "./pages/CodeEditor";
import ProtectedRouter from "./middleWare/ProtectedRouter";

const App = () => {
  return (
    <Router>
      <Routes>

        <Route
          path="/:roomId"
          element={<Register />} />
        <Route path="/" element={<Register />} />

        <Route path="/code/:roomId" element={ <ProtectedRouter  > <CodeEditor /> </ProtectedRouter>} />
      </Routes>
    </Router>
  );
};

export default App;
