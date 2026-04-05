import { registerRootComponent } from "expo";
import App from "./App";
import { supabase } from "./src/lib/supabase";

// ✅ Reset session si refresh token invalide (ancien compte / compte supprimé)
(async () => {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      const msg = String(error.message || "");
      console.log("AUTH_GET_SESSION_ERROR =", msg);

      // si refresh token cassé -> signOut (nettoie la session locale)
      if (msg.toLowerCase().includes("refresh token")) {
        console.log("AUTH_RESET: invalid refresh token -> signOut()");
        await supabase.auth.signOut();
      }
    } else if (data?.session?.user?.id) {
      console.log("AUTH_SESSION_USER_ID =", data.session.user.id);
    }
  } catch (e) {
    console.log("AUTH_RESET_EXCEPTION =", e);
    try {
      await supabase.auth.signOut();
    } catch {}
  }
})();

registerRootComponent(App);
