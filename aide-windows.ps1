# Aide Windows du copilote CK3 : un seul PowerShell qui reste lancé (un PowerShell neuf coûte ~0,6 s par capture).
# Il parle à Node en lignes JSON (UTF-8) sur stdin/stdout : requêtes {id, cmd}, réponses {id, ok, res | code, erreur},
# événements {evt}. Rien n'est écrit sur le disque : les images voyagent en base64 dans la ligne JSON.
# - capture de la seule fenêtre CK3 par son handle (PrintWindow, options 3 puis 2), jamais de l'écran entier ;
# - crochet clavier bas niveau (WH_KEYBOARD_LL) pour Ctrl+Maj+Espace : il avale seulement ce combo, et seulement quand CK3 est
#   au premier plan (sinon CK3 basculerait la pause) ; ailleurs (Word : espace insécable) le combo passe sans rien déclencher.
#   Toutes les autres touches passent ; il n'envoie jamais de touche ;
# - il se ferme tout seul quand stdin se ferme (Node mort) : aucun processus orphelin ne garde le crochet ;
# - regard pendant une question (07/10/2026) : « apercu » imprime CK3 sans encoder d'image et rend une empreinte grise 32x18
#   (pour que Node voie si l'écran a changé), la souris et depuis quand elle est immobile (position lue en lecture seule,
#   10 fois par seconde, 25 pendant une question) ; l'image reste en mémoire ici et « capturer » avec son jeton l'encode telle
#   quelle. Rien n'est imprimé quand CK3 n'est pas au premier plan.
# Les messages pour Ameur sont en français côté Node (aide-windows.mjs) : ici, seulement des codes ASCII.
# C# 5 seulement (PowerShell 5.1) : pas de $"", pas de =>, pas de ?. Add-Type traite les avertissements comme des erreurs
# (une variable inutilisée suffit à tout bloquer) : relancer essais/essai-aide.mjs après chaque retouche.
param([string]$Processus = 'ck3', [switch]$SansCrochet)
$ErrorActionPreference = 'Stop'
# Erreurs de PowerShell en UTF-8 sur stderr : Node les lit ainsi pour le journal.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$source = @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace CopiloteCk3
{
  // Erreur attendue (CK3 absent, réduit...) : Node la traduit en français grâce à son code.
  public sealed class ErreurAide : Exception
  {
    public readonly string Code;
    public ErreurAide(string code, string detail) : base(detail) { Code = code; }
  }

  // Décision du raccourci, séparée du crochet : on peut la tester (commande banc) sans envoyer la moindre touche au système.
  public sealed class Raccourci
  {
    public const int VK_SPACE = 0x20;
    bool tenu;        // l'appui de Espace a été avalé : son relâchement doit l'être aussi, sinon CK3 verrait un relâchement orphelin
    int dernier;      // horodatage (ms, horloge du clavier) du dernier événement Espace avalé
    long horsJeu;     // combos laissés à une autre appli (pour le diagnostic)
    public bool Tenu { get { return tenu; } }
    public long HorsJeu { get { return horsJeu; } }

    // Retourne true s'il faut avaler la touche ; evt = "appui", "relache" ou null. jeu : CK3 a la fenêtre au premier plan.
    // Ailleurs, Ctrl+Maj+Espace reste à l'appli (espace insécable de Word, sélection d'Excel...) : ni avalé, ni signalé.
    public bool Traiter(int vk, bool enfonce, bool ctrl, bool shift, bool alt, bool jeu, int temps, out string evt)
    {
      evt = null;
      if (vk != VK_SPACE) return false;
      bool combo = ctrl && shift && !alt;   // Alt exclu : sur AZERTY, AltGr envoie Ctrl+Alt et ne doit pas déclencher le copilote.
      if (enfonce)
      {
        if (tenu)
        {
          // Répétition automatique : on avale sans rien signaler, même si le premier plan a changé (l'appui a été pris dans CK3).
          // Plus de 1,5 s sans répétition = relâchement perdu (bureau sécurisé, crochet retiré...) : on repart de zéro pour ne
          // jamais bloquer la barre d'espace de CK3.
          if (unchecked(temps - dernier) < 1500) { dernier = temps; return true; }
          tenu = false;
          if (!(combo && jeu)) { evt = "relache"; return false; }
        }
        if (!combo) return false;
        if (!jeu) { horsJeu++; return false; }
        tenu = true; dernier = temps; evt = "appui"; return true;
      }
      if (!tenu) return false;
      tenu = false; evt = "relache"; return true;
    }
  }

  // Une vue de CK3 imprimée, pas encore encodée : image, empreinte, souris au moment de l'impression.
  public sealed class Vue
  {
    public Bitmap Image;
    public byte[] Signature;
    public int X, Y;
    public bool Dedans, SurJeu, PremierPlan;
    public double Moyenne, Ecart;
    public uint Options;
    public long Immobile, Jeton, Quand, MsImpression;
  }

  // Objet JSON écrit à la main : pas de dépendance (System.Web.Extensions) et les longues chaînes base64 passent telles quelles.
  public sealed class Obj
  {
    readonly StringBuilder sb = new StringBuilder("{");
    bool vide = true;
    Obj Cle(string k) { if (!vide) sb.Append(','); vide = false; sb.Append('"').Append(k).Append("\":"); return this; }
    public Obj Txt(string k, string v) { Cle(k); if (v == null) sb.Append("null"); else Aide.Echapper(sb, v); return this; }
    public Obj B64(string k, byte[] v) { Cle(k); if (v == null) sb.Append("null"); else sb.Append('"').Append(Convert.ToBase64String(v)).Append('"'); return this; }
    public Obj Ent(string k, long v) { Cle(k); sb.Append(v.ToString(CultureInfo.InvariantCulture)); return this; }
    public Obj Dec(string k, double v) { Cle(k); if (double.IsNaN(v) || double.IsInfinity(v)) v = 0; sb.Append(Math.Round(v, 2).ToString("0.##", CultureInfo.InvariantCulture)); return this; }
    public Obj Bool(string k, bool v) { Cle(k); sb.Append(v ? "true" : "false"); return this; }
    public Obj Brut(string k, string json) { Cle(k); sb.Append(json == null ? "null" : json); return this; }
    public override string ToString() { return sb.ToString() + "}"; }
  }

  public static class Aide
  {
    // ---------- Win32 ----------
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref POINT p);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hmon, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SetTimer(IntPtr hwnd, IntPtr id, uint ms, IntPtr fn);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string nom);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint acces, bool heriter, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int options, StringBuilder nom, ref int taille);

    static readonly IntPtr PER_MONITOR_V2 = new IntPtr(-4);   // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 : coordonnées en pixels réels
    const int WH_KEYBOARD_LL = 13;
    const uint WM_QUIT = 0x12, WM_TIMER = 0x113;
    const int LLKHF_UP = 0x80;
    const uint GA_ROOT = 2;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    // ---------- état ----------
    static string nomProcessus = "ck3";
    static IntPtr fenetre = IntPtr.Zero;
    static uint pidFenetre;
    static volatile uint pidJeu;   // pid de CK3 lu par le crochet (autre fil) ; tenu à jour par TrouverCk3 et par PremierPlanJeu
    static readonly BlockingCollection<string> fileSortie = new BlockingCollection<string>();
    static readonly BlockingCollection<string> fileCommandes = new BlockingCollection<string>();
    static Thread filSortie, filCrochet, filTravail;
    static ImageCodecInfo codecJpeg;

    // Crochet : le délégué reste dans un champ statique, sinon le ramasse-miettes le libère et Windows appelle du vide.
    static HookProc procCrochet;
    static IntPtr hCrochet = IntPtr.Zero;
    static uint idFilCrochet;
    static int erreurCrochet;
    static readonly ManualResetEvent crochetPret = new ManualResetEvent(false);
    static readonly Raccourci raccourci = new Raccourci();
    static long appels, espaces, avales, ticksTotal, ticksMax, reinstallations;
    static readonly DateTime epoque = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    // Empreinte d'une vue : gris moyen de chaque case d'une grille 32x18 (576 octets).
    public const int SIG_L = 32, SIG_H = 18;
    // Dernier aperçu, gardé en mémoire (fil de travail seulement) jusqu'à son encodage, l'aperçu suivant ou 10 s.
    static Vue retenue;
    static long jetons;
    // Suivi de la souris : horodatages Stopwatch (début du suivi, dernier mouvement, fin du relevé rapide), lus et écrits par
    // deux fils.
    static Thread filSouris;
    static long sourisDebut, sourisBouge, sourisJusqua;

    public static void Executer(string processus, bool avecCrochet)
    {
      if (!string.IsNullOrEmpty(processus)) nomProcessus = processus;
      bool dpiProcessus = false;
      try { dpiProcessus = SetProcessDpiAwarenessContext(PER_MONITOR_V2); } catch (Exception) { }
      try { SetThreadDpiAwarenessContext(PER_MONITOR_V2); } catch (Exception) { }
      // Les pauses du ramasse-miettes gèlent aussi le fil du crochet : on les veut courtes.
      GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency;

      filSortie = new Thread(Ecrivain); filSortie.IsBackground = true; filSortie.Start();
      if (avecCrochet)
      {
        filCrochet = new Thread(BoucleCrochet); filCrochet.IsBackground = true;
        filCrochet.Priority = ThreadPriority.Highest;   // répondre vite même quand CK3 charge le processeur
        filCrochet.Start();
        crochetPret.WaitOne(5000);
      }
      sourisDebut = sourisBouge = Stopwatch.GetTimestamp();
      filSouris = new Thread(BoucleSouris); filSouris.IsBackground = true; filSouris.Start();
      filTravail = new Thread(Travailleur); filTravail.IsBackground = true; filTravail.Start();

      Envoyer(new Obj().Bool("pret", true).Ent("pid", Process.GetCurrentProcess().Id).Txt("processus", nomProcessus)
        .Bool("crochet", hCrochet != IntPtr.Zero).Ent("erreurCrochet", erreurCrochet).Bool("dpiProcessus", dpiProcessus).ToString());

      // Lecture de stdin sur le fil principal : la fin du flux (Node arrêté ou mort) ferme l'aide aussitôt,
      // même si une capture est en cours sur le fil de travail.
      StreamReader entree = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
      string ligne;
      try { while ((ligne = entree.ReadLine()) != null) { if (ligne.Trim().Length > 0) fileCommandes.Add(ligne); } }
      catch (Exception) { }
      Quitter(0);
    }

    static void Quitter(int code)
    {
      ArreterCrochet();
      try { fileSortie.CompleteAdding(); } catch (Exception) { }
      if (filSortie != null && Thread.CurrentThread != filSortie) filSortie.Join(1000);
      Terminer(code);
    }

    // Arrêt net : l'arrêt normal de PowerShell prend ~2 s de plus, et il n'y a plus rien à ranger (crochet retiré, sortie vidée).
    static void Terminer(int code) { TerminateProcess(GetCurrentProcess(), (uint)code); Environment.Exit(code); }

    static void ArreterCrochet()
    {
      if (idFilCrochet != 0) PostThreadMessage(idFilCrochet, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
      if (filCrochet != null && Thread.CurrentThread != filCrochet) filCrochet.Join(1000);
    }

    static void Envoyer(string ligne) { try { fileSortie.Add(ligne); } catch (Exception) { } }

    // Seul ce fil écrit sur stdout : le crochet et le travail ne font que déposer leurs lignes dans la file.
    static void Ecrivain()
    {
      try
      {
        StreamWriter w = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false), 1 << 16);
        foreach (string ligne in fileSortie.GetConsumingEnumerable())
        {
          w.Write(ligne); w.Write('\n');
          if (fileSortie.Count == 0) w.Flush();
        }
        w.Flush();
      }
      catch (Exception)
      {
        // stdout fermé : Node n'écoute plus, on part (le crochet est retiré avant).
        ArreterCrochet();
        Terminer(0);
      }
    }

    // ---------- commandes ----------
    static void Travailleur()
    {
      try { SetThreadDpiAwarenessContext(PER_MONITOR_V2); } catch (Exception) { }
      foreach (string ligne in fileCommandes.GetConsumingEnumerable())
      {
        string id = "null";
        // Un aperçu jamais réclamé (question annulée, Node arrêté au mauvais moment) ne reste pas en mémoire.
        if (retenue != null && AgeMs(retenue) > 10000) Liberer();
        try
        {
          Dictionary<string, string> req = LireObjet(ligne);
          string v;
          if (req.TryGetValue("id", out v)) id = Nombre(v) ? v : "null";
          string cmd = req.TryGetValue("cmd", out v) ? v : "";
          string res;
          if (cmd == "etat") res = Etat();
          else if (cmd == "capturer") res = Capturer(Entier(req, "qualite", 85), Entier(req, "largeurMax", 1920), Entier(req, "zoomL", 960), Entier(req, "zoomH", 600), Entier(req, "jeton", 0));
          else if (cmd == "apercu") res = Apercu();
          else if (cmd == "liberer") { bool avait = retenue != null; Liberer(); res = new Obj().Bool("libere", avait).ToString(); }
          else if (cmd == "diagnostic") res = Diagnostic();
          else if (cmd == "banc") res = Banc();
          else if (cmd == "reinstaller") res = DemanderReinstallation();
          else throw new ErreurAide("commande", "commande inconnue : " + cmd);
          Envoyer(new Obj().Brut("id", id).Bool("ok", true).Brut("res", res).ToString());
        }
        catch (ErreurAide e) { Envoyer(new Obj().Brut("id", id).Bool("ok", false).Txt("code", e.Code).Txt("erreur", e.Message).ToString()); }
        catch (Exception e) { Envoyer(new Obj().Brut("id", id).Bool("ok", false).Txt("code", "interne").Txt("erreur", e.GetType().Name + " : " + e.Message).ToString()); }
      }
    }

    static int Entier(Dictionary<string, string> req, string cle, int defaut)
    {
      string v; int n;
      if (req.TryGetValue(cle, out v) && int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out n)) return n;
      return defaut;
    }

    // ---------- fenêtre CK3 ----------
    static IntPtr TrouverCk3()
    {
      if (fenetre != IntPtr.Zero && IsWindow(fenetre) && IsWindowVisible(fenetre))
      {
        uint pid; GetWindowThreadProcessId(fenetre, out pid);
        if (pid == pidFenetre) return fenetre;
      }
      fenetre = IntPtr.Zero; pidFenetre = 0;
      List<uint> pids = new List<uint>();
      foreach (Process p in Process.GetProcessesByName(nomProcessus)) { pids.Add((uint)p.Id); p.Dispose(); }
      if (pids.Count == 0) { pidJeu = 0; return IntPtr.Zero; }
      // La fenêtre du jeu est une fenêtre SDL (classe SDL_app) ; à défaut, la plus grande fenêtre visible du processus.
      IntPtr meilleure = IntPtr.Zero; uint pidMeilleure = 0; long aire = -1; bool sdl = false;
      EnumWindowsProc cb = delegate (IntPtr hw, IntPtr lp)
      {
        uint pid; GetWindowThreadProcessId(hw, out pid);
        if (!pids.Contains(pid) || !IsWindowVisible(hw)) return true;
        StringBuilder sb = new StringBuilder(64); GetClassName(hw, sb, 64);
        bool estSdl = sb.ToString() == "SDL_app";
        RECT r; GetWindowRect(hw, out r);
        long a = (long)(r.R - r.L) * (r.B - r.T);
        if ((estSdl && !sdl) || (estSdl == sdl && a > aire)) { meilleure = hw; pidMeilleure = pid; aire = a; sdl = estSdl; }
        return true;
      };
      EnumWindows(cb, IntPtr.Zero);
      GC.KeepAlive(cb);
      fenetre = meilleure; pidFenetre = pidMeilleure;
      if (pidMeilleure != 0) pidJeu = pidMeilleure;
      return fenetre;
    }

    // Le processus pid a-t-il la fenêtre au premier plan ? (comparaison par processus : une fenêtre annexe de CK3 compte aussi)
    static bool AuPremierPlan(uint pid)
    {
      uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p);
      return pid != 0 && p == pid;
    }

    // CK3 a-t-il la fenêtre au premier plan ? Appelé par le crochet, seulement quand le combo est pressé. Chemin rapide : le pid
    // déjà connu ; sinon le nom de l'exécutable, lu sans énumérer les processus (quelques dizaines de µs).
    static bool PremierPlanJeu()
    {
      uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      if (pid == 0) return false;
      if (pid == pidJeu) return true;
      if (!string.Equals(NomExe(pid), nomProcessus, StringComparison.OrdinalIgnoreCase)) return false;
      pidJeu = pid;
      return true;
    }

    // Nom de l'exécutable d'un processus (sans .exe), ou null s'il n'est pas lisible.
    static string NomExe(uint pid)
    {
      IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (h == IntPtr.Zero) return null;
      try
      {
        StringBuilder sb = new StringBuilder(1024);
        int n = sb.Capacity;
        return QueryFullProcessImageName(h, 0, sb, ref n) ? Path.GetFileNameWithoutExtension(sb.ToString(0, n)) : null;
      }
      finally { CloseHandle(h); }
    }

    static string Rect(int x, int y, int w, int h) { return new Obj().Ent("x", x).Ent("y", y).Ent("w", w).Ent("h", h).ToString(); }

    static string Etat()
    {
      IntPtr h = TrouverCk3();
      MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      IntPtr mon = h != IntPtr.Zero ? MonitorFromWindow(h, 1) : MonitorFromPoint(new POINT(), 1);   // 1 = écran principal à défaut
      GetMonitorInfo(mon, ref mi);
      string ecran = new Obj().Ent("w", mi.rcMonitor.R - mi.rcMonitor.L).Ent("h", mi.rcMonitor.B - mi.rcMonitor.T).ToString();
      Obj o = new Obj().Bool("ck3", h != IntPtr.Zero).Brut("hwnd", h == IntPtr.Zero ? null : h.ToInt64().ToString(CultureInfo.InvariantCulture));
      if (h == IntPtr.Zero) return o.Brut("rect", null).Bool("minimise", false).Bool("premierPlan", false).Brut("ecran", ecran).ToString();
      bool minimise = IsIconic(h);
      RECT r; GetWindowRect(h, out r);
      // Réduite, la fenêtre est rangée vers (-32000, -32000) : ce rectangle ne veut rien dire.
      return o.Brut("rect", minimise ? null : Rect(r.L, r.T, r.R - r.L, r.B - r.T)).Bool("minimise", minimise)
        .Bool("premierPlan", AuPremierPlan(pidFenetre)).Bool("repond", !IsHungAppWindow(h)).Ent("pid", pidFenetre).Brut("ecran", ecran).ToString();
    }

    // ---------- capture ----------
    static Bitmap Imprimer(IntPtr h, uint options, int largeur, int hauteur)
    {
      Bitmap bmp = new Bitmap(largeur, hauteur, PixelFormat.Format24bppRgb);
      bool ok;
      using (Graphics g = Graphics.FromImage(bmp))
      {
        IntPtr hdc = g.GetHdc();
        try { ok = PrintWindow(h, hdc, options); } finally { g.ReleaseHdc(hdc); }
      }
      if (ok) return bmp;
      bmp.Dispose();
      return null;
    }

    // Luminosité moyenne et écart-type sur un pixel sur 16 : une capture ratée de DirectX revient noire et uniforme. Dans le même
    // passage, l'empreinte (signature, si demandée) : gris moyen de chaque case 32x18, de quoi dire à Node si l'écran a changé
    // (info-bulle, panneau ouvert, carte déplacée) sans encoder ni envoyer d'image.
    static void Analyser(Bitmap bmp, byte[] signature, out double moyenne, out double ecart)
    {
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      try
      {
        int pas = Math.Abs(d.Stride), w = bmp.Width, ht = bmp.Height;
        byte[] ligne = new byte[pas];
        double[] sommes = new double[SIG_L * SIG_H];
        int[] nombres = new int[SIG_L * SIG_H];
        double s = 0, s2 = 0; long n = 0;
        for (int y = 0; y < ht; y += 4)
        {
          Marshal.Copy(new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), ligne, 0, pas);
          int rang = (y * SIG_H / ht) * SIG_L;
          for (int x = 0; x < w; x += 4)
          {
            int i = x * 3;
            double l = 0.114 * ligne[i] + 0.587 * ligne[i + 1] + 0.299 * ligne[i + 2];
            s += l; s2 += l * l; n++;
            int k = rang + x * SIG_L / w;
            sommes[k] += l; nombres[k]++;
          }
        }
        moyenne = n > 0 ? s / n : 0;
        double v = n > 0 ? s2 / n - moyenne * moyenne : 0;
        ecart = v > 0 ? Math.Sqrt(v) : 0;
        if (signature != null)
          for (int k = 0; k < sommes.Length && k < signature.Length; k++)
            signature[k] = (byte)Math.Max(0, Math.Min(255, Math.Round(nombres[k] > 0 ? sommes[k] / nombres[k] : 0)));
      }
      finally { bmp.UnlockBits(d); }
    }

    // ---------- souris ----------
    // Les info-bulles de CK3 n'apparaissent que si la souris reste immobile. Ce fil lit sa position (lecture seule, quelques µs) :
    // toutes les 100 ms en temps normal, pour savoir AU MOMENT DE L'APPUI depuis quand elle ne bouge plus (Ameur survole une
    // info-bulle, puis appuie : le suivi qui ne démarrait qu'à l'appui annonçait « souris en mouvement » sur cette image), et toutes
    // les 40 ms pendant les 45 s qui suivent une capture. Seuls le dernier point de repos et l'heure du dernier mouvement sont gardés.
    static void BoucleSouris()
    {
      bool premier = true;
      int ax = 0, ay = 0;
      while (true)
      {
        POINT p;
        if (GetCursorPos(out p))
        {
          // Comparée au dernier point de repos, pas au relevé précédent : un glissement lent compte aussi comme un mouvement.
          if (premier || Math.Abs(p.X - ax) > 2 || Math.Abs(p.Y - ay) > 2)
          {
            if (!premier) Interlocked.Exchange(ref sourisBouge, Stopwatch.GetTimestamp());
            premier = false; ax = p.X; ay = p.Y;
          }
        }
        Thread.Sleep(Stopwatch.GetTimestamp() < Interlocked.Read(ref sourisJusqua) ? 40 : 100);
      }
    }

    // Relevé rapide pendant la question qui commence.
    static void SuivreSouris() { Interlocked.Exchange(ref sourisJusqua, Stopwatch.GetTimestamp() + 45 * Stopwatch.Frequency); }

    // Depuis quand la souris ne bouge plus (ms), ou -1 si on l'ignore : aucun mouvement vu depuis le début du suivi (aide qui vient
    // de démarrer ou d'être relancée) et moins de 0,5 s de suivi. Au-delà, c'est un minimum, vrai dans tous les cas.
    static long ImmobileMs()
    {
      long bouge = Interlocked.Read(ref sourisBouge);
      long ms = (Stopwatch.GetTimestamp() - bouge) * 1000 / Stopwatch.Frequency;
      return bouge == sourisDebut && ms < 500 ? -1 : ms;
    }
    static long AgeMs(Vue v) { return (Stopwatch.GetTimestamp() - v.Quand) * 1000 / Stopwatch.Frequency; }

    static void Liberer()
    {
      if (retenue == null) return;
      if (retenue.Image != null) retenue.Image.Dispose();
      retenue = null;
    }

    static byte[] Jpeg(Image img, long qualite)
    {
      if (codecJpeg == null) foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codecJpeg = c;
      using (EncoderParameters ep = new EncoderParameters(1))
      using (MemoryStream ms = new MemoryStream(1 << 19))
      {
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, qualite);
        img.Save(ms, codecJpeg, ep);
        return ms.ToArray();
      }
    }

    static Bitmap Reduire(Bitmap src, int largeur)
    {
      int hauteur = Math.Max(1, (int)Math.Round((double)src.Height * largeur / src.Width));
      Bitmap dst = new Bitmap(largeur, hauteur, PixelFormat.Format24bppRgb);
      using (Graphics g = Graphics.FromImage(dst))
      using (ImageAttributes ia = new ImageAttributes())
      {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighQuality;
        ia.SetWrapMode(WrapMode.TileFlipXY);   // évite le liseré sombre sur les bords
        g.DrawImage(src, new Rectangle(0, 0, largeur, hauteur), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, ia);
      }
      return dst;
    }

    // CK3 capturable ? Fenêtre trouvée, ni réduite, ni figée (PrintWindow attendrait indéfiniment), assez grande.
    static IntPtr FenetreCapturable(out int w, out int ht)
    {
      IntPtr h = TrouverCk3();
      if (h == IntPtr.Zero) throw new ErreurAide("pas-lance", "aucune fenetre " + nomProcessus);
      if (IsIconic(h)) throw new ErreurAide("reduit", "fenetre reduite");
      if (IsHungAppWindow(h)) throw new ErreurAide("ne-repond-pas", "fenetre bloquee");
      RECT rc; GetClientRect(h, out rc);
      w = rc.R - rc.L; ht = rc.B - rc.T;
      if (w < 64 || ht < 64) throw new ErreurAide("trop-petite", "zone client " + w + "x" + ht);
      return h;
    }

    // Zone client de CK3 imprimée, avec son empreinte et la souris de cet instant.
    static Vue Prendre(IntPtr h, int w, int ht)
    {
      Stopwatch chrono = Stopwatch.StartNew();
      Vue v = new Vue();
      v.Signature = new byte[SIG_L * SIG_H];
      // Options 3 = PW_CLIENTONLY | PW_RENDERFULLCONTENT (le contenu DirectX passe par DWM) ; options 2 en secours.
      v.Options = 3;
      Bitmap image = Imprimer(h, 3, w, ht);
      if (image != null) Analyser(image, v.Signature, out v.Moyenne, out v.Ecart);
      if (image == null || v.Ecart < 2)
      {
        if (image != null) image.Dispose();
        image = null; v.Options = 2;
        RECT wr; GetWindowRect(h, out wr);
        POINT o = new POINT(); ClientToScreen(h, ref o);
        Bitmap entiere = Imprimer(h, 2, wr.R - wr.L, wr.B - wr.T);
        if (entiere != null)
        {
          int dx = o.X - wr.L, dy = o.Y - wr.T;
          if (dx == 0 && dy == 0 && entiere.Width == w && entiere.Height == ht) image = entiere;
          else
          {
            Rectangle zone = Rectangle.Intersect(new Rectangle(dx, dy, w, ht), new Rectangle(0, 0, entiere.Width, entiere.Height));
            if (zone.Width > 0 && zone.Height > 0) image = entiere.Clone(zone, PixelFormat.Format24bppRgb);
            entiere.Dispose();
          }
        }
        if (image == null) throw new ErreurAide("echec", "PrintWindow a echoue");
        Analyser(image, v.Signature, out v.Moyenne, out v.Ecart);
        if (v.Ecart < 2) { image.Dispose(); throw new ErreurAide("noire", "ecart-type " + v.Ecart.ToString("0.##", CultureInfo.InvariantCulture)); }
      }
      v.Image = image;
      v.MsImpression = chrono.ElapsedMilliseconds;
      // Curseur en pixels de la zone client. surJeu : sur la fenêtre de CK3 elle-même ; sinon (icône du copilote par exemple)
      // pas de zoom, il montrerait un endroit que personne ne désigne.
      POINT c; GetCursorPos(out c);
      POINT origine = new POINT(); ClientToScreen(h, ref origine);
      v.X = c.X - origine.X; v.Y = c.Y - origine.Y;
      v.Dedans = v.X >= 0 && v.Y >= 0 && v.X < image.Width && v.Y < image.Height;
      v.SurJeu = v.Dedans && GetAncestor(WindowFromPoint(c), GA_ROOT) == h;
      v.Immobile = ImmobileMs();
      v.PremierPlan = AuPremierPlan(pidFenetre);
      v.Quand = Stopwatch.GetTimestamp();
      return v;
    }

    // Aperçu léger pendant une question : impression + empreinte + souris, sans JPEG. L'image reste ici, en mémoire, avec un jeton :
    // si Node juge la vue nouvelle, « capturer » avec ce jeton l'encode telle quelle (pas de second PrintWindow, et l'info-bulle vue
    // dans l'aperçu est bien celle de l'image). CK3 pas au premier plan : rien n'est imprimé (Ameur est passé à une autre appli).
    static string Apercu()
    {
      Stopwatch chrono = Stopwatch.StartNew();
      SuivreSouris();
      Liberer();
      int w, ht;
      IntPtr h = FenetreCapturable(out w, out ht);
      if (!AuPremierPlan(pidFenetre))
        return new Obj().Bool("premierPlan", false).Ent("immobileMs", ImmobileMs()).Ent("ms", chrono.ElapsedMilliseconds).ToString();
      Vue v = Prendre(h, w, ht);
      v.Jeton = ++jetons;
      retenue = v;
      return new Obj().Bool("premierPlan", v.PremierPlan).B64("signature", v.Signature)
        .Brut("curseur", v.Dedans ? new Obj().Ent("x", v.X).Ent("y", v.Y).ToString() : null).Bool("curseurSurJeu", v.SurJeu)
        .Ent("immobileMs", v.Immobile).Ent("jeton", v.Jeton).Ent("largeurFenetre", v.Image.Width).Ent("hauteurFenetre", v.Image.Height)
        .Dec("ecartType", v.Ecart).Ent("msImpression", v.MsImpression).Ent("ms", chrono.ElapsedMilliseconds).ToString();
    }

    // jeton > 0 : encode l'aperçu gardé (3 s au plus), sinon imprime CK3 maintenant.
    static string Capturer(int qualite, int largeurMax, int zoomL, int zoomH, long jeton)
    {
      Stopwatch chrono = Stopwatch.StartNew();
      qualite = Math.Max(30, Math.Min(95, qualite)); largeurMax = Math.Max(320, largeurMax);
      Vue v;
      if (jeton > 0)
      {
        v = retenue;
        if (v == null || v.Jeton != jeton || AgeMs(v) > 3000) throw new ErreurAide("perimee", "apercu " + jeton + " indisponible");
        retenue = null;
      }
      else
      {
        SuivreSouris();
        int w, ht;
        IntPtr h = FenetreCapturable(out w, out ht);
        v = Prendre(h, w, ht);
      }
      Bitmap image = v.Image;
      try
      {
        byte[] zoom = null; string zoneZoom = null;
        if (v.SurJeu)
        {
          int zl = Math.Min(Math.Max(64, zoomL), image.Width), zh = Math.Min(Math.Max(64, zoomH), image.Height);
          int x0 = Math.Max(0, Math.Min(v.X - zl / 2, image.Width - zl)), y0 = Math.Max(0, Math.Min(v.Y - zh / 2, image.Height - zh));
          using (Bitmap z = image.Clone(new Rectangle(x0, y0, zl, zh), PixelFormat.Format24bppRgb)) zoom = Jpeg(z, qualite);
          zoneZoom = Rect(x0, y0, zl, zh);
        }
        int largeur = image.Width, hauteur = image.Height;
        byte[] plein;
        if (image.Width > largeurMax)
        {
          using (Bitmap r = Reduire(image, largeurMax)) { plein = Jpeg(r, qualite); largeur = r.Width; hauteur = r.Height; }
        }
        else plein = Jpeg(image, qualite);
        long ms = chrono.ElapsedMilliseconds;
        return new Obj().B64("plein", plein).B64("zoom", zoom).Brut("zoneZoom", zoneZoom)
          .Brut("curseur", v.Dedans ? new Obj().Ent("x", v.X).Ent("y", v.Y).ToString() : null).Bool("curseurSurJeu", v.SurJeu)
          .Ent("largeur", largeur).Ent("hauteur", hauteur).Ent("largeurFenetre", image.Width).Ent("hauteurFenetre", image.Height)
          .Dec("ecartType", v.Ecart).Dec("moyenne", v.Moyenne).Ent("options", v.Options).Bool("premierPlan", v.PremierPlan)
          .B64("signature", v.Signature).Ent("immobileMs", v.Immobile).Ent("ageMs", AgeMs(v))
          .Ent("msImpression", v.MsImpression).Ent("ms", ms).ToString();
      }
      finally { image.Dispose(); }
    }

    // ---------- crochet clavier ----------
    static void BoucleCrochet()
    {
      idFilCrochet = GetCurrentThreadId();
      MSG m;
      PeekMessage(out m, IntPtr.Zero, 0, 0, 0);   // crée la file de messages du fil avant tout PostThreadMessage
      // Compilation JIT faite d'avance : le premier appui ne doit pas payer la compilation dans le rappel du crochet.
      RuntimeHelpers.PrepareMethod(typeof(Aide).GetMethod("Crochet", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
      RuntimeHelpers.PrepareMethod(typeof(Aide).GetMethod("Envoyer", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
      RuntimeHelpers.PrepareMethod(typeof(Raccourci).GetMethod("Traiter").MethodHandle);
      RuntimeHelpers.PrepareMethod(typeof(Aide).GetMethod("PremierPlanJeu", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
      RuntimeHelpers.PrepareMethod(typeof(Aide).GetMethod("NomExe", BindingFlags.NonPublic | BindingFlags.Static).MethodHandle);
      procCrochet = new HookProc(Crochet);
      hCrochet = SetWindowsHookEx(WH_KEYBOARD_LL, procCrochet, GetModuleHandle(null), 0);
      if (hCrochet == IntPtr.Zero) erreurCrochet = Marshal.GetLastWin32Error();
      crochetPret.Set();
      if (hCrochet == IntPtr.Zero) return;
      // Windows retire en silence un crochet qui a tardé une fois (LowLevelHooksTimeout) : on le réinstalle toutes les 5 min.
      SetTimer(IntPtr.Zero, IntPtr.Zero, 300000, IntPtr.Zero);
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0)
      {
        if (m.message == WM_TIMER && !raccourci.Tenu)
        {
          IntPtr nouveau = SetWindowsHookEx(WH_KEYBOARD_LL, procCrochet, GetModuleHandle(null), 0);
          if (nouveau != IntPtr.Zero) { UnhookWindowsHookEx(hCrochet); hCrochet = nouveau; reinstallations++; }
        }
      }
      UnhookWindowsHookEx(hCrochet);
      hCrochet = IntPtr.Zero;
    }

    // Appelé par Windows pour CHAQUE touche du système : rester trivial. Pour une touche autre qu'Espace,
    // une lecture mémoire et une comparaison ; l'écriture vers Node se fait sur un autre fil.
    static IntPtr Crochet(int nCode, IntPtr wParam, IntPtr lParam)
    {
      long debut = Stopwatch.GetTimestamp();
      bool avaler = false;
      if (nCode >= 0)
      {
        int vk = Marshal.ReadInt32(lParam);   // KBDLLHOOKSTRUCT.vkCode
        if (vk == Raccourci.VK_SPACE)
        {
          int drapeaux = Marshal.ReadInt32(lParam, 8), temps = Marshal.ReadInt32(lParam, 12);
          bool enfonce = (drapeaux & LLKHF_UP) == 0;
          bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0, shift = (GetAsyncKeyState(0x10) & 0x8000) != 0, alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
          // La fenêtre au premier plan n'est regardée que pour un appui sur le combo : le chemin courant reste trivial.
          bool jeu = enfonce && ctrl && shift && !alt ? PremierPlanJeu() : true;
          string evt;
          avaler = raccourci.Traiter(vk, enfonce, ctrl, shift, alt, jeu, temps, out evt);
          espaces++;
          if (avaler) avales++;
          if (evt != null)
          {
            long t = (long)(DateTime.UtcNow - epoque).TotalMilliseconds;
            Envoyer("{\"evt\":\"raccourci\",\"etat\":\"" + evt + "\",\"t\":" + t.ToString(CultureInfo.InvariantCulture) + "}");
          }
        }
        long duree = Stopwatch.GetTimestamp() - debut;
        appels++; ticksTotal += duree;
        if (duree > ticksMax) ticksMax = duree;
      }
      if (avaler) return new IntPtr(1);
      return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    // Pour l'essai : déclenche tout de suite la réinstallation prévue toutes les 5 min.
    static string DemanderReinstallation()
    {
      if (idFilCrochet == 0 || hCrochet == IntPtr.Zero) throw new ErreurAide("sans-crochet", "aucun crochet");
      return new Obj().Bool("demande", PostThreadMessage(idFilCrochet, WM_TIMER, IntPtr.Zero, IntPtr.Zero)).ToString();
    }

    static double Micro(long ticks) { return ticks * 1000000.0 / Stopwatch.Frequency; }

    static string Diagnostic()
    {
      long n = appels;
      return new Obj().Bool("crochet", hCrochet != IntPtr.Zero).Ent("erreurCrochet", erreurCrochet).Ent("appels", n).Ent("espaces", espaces)
        .Ent("avales", avales).Dec("microMax", Micro(ticksMax)).Dec("microMoyen", n > 0 ? Micro(ticksTotal) / n : 0)
        .Ent("reinstallations", reinstallations).Bool("tenu", raccourci.Tenu).Ent("horsJeu", raccourci.HorsJeu).Bool("premierPlanJeu", PremierPlanJeu())
        .Ent("immobileMs", ImmobileMs()).ToString();
    }

    // Banc d'essai de la décision du raccourci, sur une instance à part : aucune touche n'est envoyée au système.
    static string Banc()
    {
      List<string> echecs = new List<string>();
      int cas = 0;
      Raccourci r = new Raccourci();
      string evt; bool a;
      // 1. Ctrl+Maj+Espace dans CK3 : avalé, « appui » une seule fois malgré la répétition, « relache » au relâchement.
      a = r.Traiter(0x20, true, true, true, false, true, 1000, out evt); cas++; if (!a || evt != "appui") echecs.Add("combo appui");
      for (int i = 0; i < 3; i++) { a = r.Traiter(0x20, true, true, true, false, true, 1500 + i * 33, out evt); cas++; if (!a || evt != null) echecs.Add("repetition " + i); }
      a = r.Traiter(0x20, false, true, true, false, true, 1700, out evt); cas++; if (!a || evt != "relache") echecs.Add("combo relache");
      // 2. Espace seul (pause de CK3) : jamais touché.
      a = r.Traiter(0x20, true, false, false, false, true, 2000, out evt); cas++; if (a || evt != null) echecs.Add("espace seul appui");
      a = r.Traiter(0x20, false, false, false, false, true, 2100, out evt); cas++; if (a || evt != null) echecs.Add("espace seul relache");
      // 3. Ctrl+Espace, Maj+Espace, AltGr (Ctrl+Alt)+Maj+Espace : passent.
      a = r.Traiter(0x20, true, true, false, false, true, 2200, out evt); cas++; if (a || evt != null) echecs.Add("ctrl+espace");
      r.Traiter(0x20, false, true, false, false, true, 2250, out evt);
      a = r.Traiter(0x20, true, false, true, false, true, 2300, out evt); cas++; if (a || evt != null) echecs.Add("maj+espace");
      r.Traiter(0x20, false, false, true, false, true, 2350, out evt);
      a = r.Traiter(0x20, true, true, true, true, true, 2400, out evt); cas++; if (a || evt != null) echecs.Add("altgr+maj+espace");
      r.Traiter(0x20, false, true, true, true, true, 2450, out evt);
      // 4. Autre touche avec Ctrl+Maj : passe.
      a = r.Traiter(0x41, true, true, true, false, true, 2500, out evt); cas++; if (a || evt != null) echecs.Add("ctrl+maj+A");
      // 5. Maj relâchée avant Espace : le relâchement d'Espace est quand même avalé (CK3 n'a jamais vu l'appui).
      r.Traiter(0x20, true, true, true, false, true, 3000, out evt);
      a = r.Traiter(0x20, false, true, false, false, true, 3200, out evt); cas++; if (!a || evt != "relache") echecs.Add("relache sans maj");
      // 6. Espace enfoncé seul (passé à CK3) puis Ctrl+Maj, puis relâchement : passe, pas d'événement.
      r.Traiter(0x20, true, false, false, false, true, 4000, out evt);
      a = r.Traiter(0x20, false, true, true, false, true, 4100, out evt); cas++; if (a || evt != null) echecs.Add("relache apres espace seul");
      // 7. Relâchement perdu : 5 s plus tard, un Espace seul doit repasser à CK3 (et signaler la fin de l'appui).
      r.Traiter(0x20, true, true, true, false, true, 5000, out evt);
      a = r.Traiter(0x20, true, false, false, false, true, 10000, out evt); cas++; if (a || evt != "relache" || r.Tenu) echecs.Add("relache perdu");
      r.Traiter(0x20, false, false, false, false, true, 10050, out evt);
      // 8. Combo dans une autre appli (Word : espace insécable) : ni avalé, ni signalé, relâchement compris.
      a = r.Traiter(0x20, true, true, true, false, false, 11000, out evt); cas++; if (a || evt != null || r.Tenu) echecs.Add("combo hors jeu appui");
      a = r.Traiter(0x20, true, true, true, false, false, 11033, out evt); cas++; if (a || evt != null) echecs.Add("combo hors jeu repetition");
      a = r.Traiter(0x20, false, true, true, false, false, 11100, out evt); cas++; if (a || evt != null) echecs.Add("combo hors jeu relache");
      if (r.HorsJeu != 2) { cas++; echecs.Add("compte hors jeu " + r.HorsJeu); }
      // 9. Appui pris dans CK3, puis le premier plan change avant le relâchement : répétition et relâchement restent avalés.
      r.Traiter(0x20, true, true, true, false, true, 12000, out evt);
      a = r.Traiter(0x20, true, true, true, false, false, 12033, out evt); cas++; if (!a || evt != null) echecs.Add("repetition apres changement de fenetre");
      a = r.Traiter(0x20, false, true, true, false, false, 12100, out evt); cas++; if (!a || evt != "relache") echecs.Add("relache apres changement de fenetre");
      // 10. Voie lente du test « CK3 au premier plan » : nom de l'exécutable lu par son pid (ici ce PowerShell).
      string nom = NomExe((uint)Process.GetCurrentProcess().Id); cas++;
      if (!string.Equals(nom, "powershell", StringComparison.OrdinalIgnoreCase)) echecs.Add("nom exe : " + (nom ?? "null"));

      // Coût de la décision et de la lecture des touches de contrôle (lecture seule de l'état du clavier).
      Raccourci rb = new Raccourci();
      const int N = 1000000;
      Stopwatch sw = Stopwatch.StartNew();
      for (int i = 0; i < N; i++) rb.Traiter(i % 3 == 0 ? 0x20 : 0x41, (i & 1) == 0, false, false, false, true, i, out evt);
      double nsDecision = sw.Elapsed.TotalMilliseconds * 1e6 / N;
      const int M = 100000;
      sw.Restart();
      int bidon = 0;
      for (int i = 0; i < M; i++) bidon += GetAsyncKeyState(0x11) + GetAsyncKeyState(0x10) + GetAsyncKeyState(0x12);
      double nsTouches = sw.Elapsed.TotalMilliseconds * 1e6 / M;
      GC.KeepAlive(bidon);
      // Coût du test du premier plan fait par le crochet à chaque appui sur le combo (voie lente si CK3 n'est pas devant).
      const int P = 2000;
      sw.Restart();
      int devant = 0;
      for (int i = 0; i < P; i++) if (PremierPlanJeu()) devant++;
      double nsPremierPlan = sw.Elapsed.TotalMilliseconds * 1e6 / P;

      StringBuilder liste = new StringBuilder("[");
      for (int i = 0; i < echecs.Count; i++) { if (i > 0) liste.Append(','); Echapper(liste, echecs[i]); }
      liste.Append(']');
      return new Obj().Ent("cas", cas).Brut("echecs", liste.ToString()).Dec("nsDecision", nsDecision).Dec("nsTroisTouches", nsTouches)
        .Dec("nsPremierPlan", nsPremierPlan).Bool("jeuDevant", devant > 0).ToString();
    }

    // ---------- JSON ----------
    public static void Echapper(StringBuilder sb, string s)
    {
      sb.Append('"');
      foreach (char ch in s)
      {
        switch (ch)
        {
          case '"': sb.Append("\\\""); break;
          case '\\': sb.Append("\\\\"); break;
          case '\n': sb.Append("\\n"); break;
          case '\r': sb.Append("\\r"); break;
          case '\t': sb.Append("\\t"); break;
          default:
            if (ch < 0x20 || ch > 0x7e) sb.Append("\\u").Append(((int)ch).ToString("x4")); else sb.Append(ch);
            break;
        }
      }
      sb.Append('"');
    }

    // Identifiant renvoyé tel quel dans la réponse : seulement des chiffres, pour rester du JSON valide.
    static bool Nombre(string v)
    {
      if (v.Length == 0 || v.Length > 15) return false;
      foreach (char c in v) if (c < '0' || c > '9') return false;
      return true;
    }

    // Lecteur d'objet JSON plat (les requêtes de Node n'ont que des chaînes, nombres et booléens).
    static Dictionary<string, string> LireObjet(string s)
    {
      Dictionary<string, string> res = new Dictionary<string, string>();
      int i = 0;
      Blancs(s, ref i);
      if (i >= s.Length || s[i] != '{') throw new ErreurAide("json", "objet attendu");
      i++;
      while (true)
      {
        Blancs(s, ref i);
        if (i < s.Length && s[i] == '}') break;
        string cle = Chaine(s, ref i);
        Blancs(s, ref i);
        if (i >= s.Length || s[i] != ':') throw new ErreurAide("json", "deux-points attendu");
        i++; Blancs(s, ref i);
        string val;
        if (i < s.Length && s[i] == '"') val = Chaine(s, ref i);
        else
        {
          int debut = i;
          while (i < s.Length && s[i] != ',' && s[i] != '}') i++;
          val = s.Substring(debut, i - debut).Trim();
          if (val.IndexOf('{') >= 0 || val.IndexOf('[') >= 0) throw new ErreurAide("json", "objet imbrique non pris en charge");
        }
        res[cle] = val;
        Blancs(s, ref i);
        if (i < s.Length && s[i] == ',') { i++; continue; }
        if (i < s.Length && s[i] == '}') break;
        throw new ErreurAide("json", "virgule attendue");
      }
      return res;
    }

    static void Blancs(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

    static string Chaine(string s, ref int i)
    {
      if (i >= s.Length || s[i] != '"') throw new ErreurAide("json", "chaine attendue");
      i++;
      StringBuilder sb = new StringBuilder();
      while (i < s.Length && s[i] != '"')
      {
        char c = s[i++];
        if (c != '\\') { sb.Append(c); continue; }
        if (i >= s.Length) break;
        char e = s[i++];
        if (e == 'n') sb.Append('\n');
        else if (e == 'r') sb.Append('\r');
        else if (e == 't') sb.Append('\t');
        else if (e == 'b') sb.Append('\b');
        else if (e == 'f') sb.Append('\f');
        else if (e == 'u' && i + 4 <= s.Length) { sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture)); i += 4; }
        else sb.Append(e);
      }
      if (i >= s.Length) throw new ErreurAide("json", "chaine non terminee");
      i++;
      return sb.ToString();
    }
  }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing -Language CSharp
[CopiloteCk3.Aide]::Executer($Processus, -not $SansCrochet)
