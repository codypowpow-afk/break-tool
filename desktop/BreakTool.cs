// Standalone Windows shell for Break Tool.
// The web app (index.html, style.css, js/*) and the WebView2 SDK are embedded in the exe;
// on launch they are unpacked to %LOCALAPPDATA%\BreakTool and shown in an Edge WebView2 window.
// Built with the C# compiler that ships with .NET Framework 4.x (see build.ps1), so stick to C# 5.
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[assembly: AssemblyTitle("Break Tool")]
[assembly: AssemblyProduct("Break Tool")]
[assembly: AssemblyDescription("DnB break chopper and pattern sequencer")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace BreakTool
{
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        public static string DataDir;

        [STAThread]
        static void Main()
        {
            // WebView2 managed assemblies live inside this exe as resources.
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BreakTool");
            try
            {
                Unpack();
            }
            catch (Exception e)
            {
                MessageBox.Show("Could not unpack Break Tool files:\n" + e.Message, "Break Tool", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Shell.Run();
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name + ".dll";
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("lib/" + name))
            {
                if (s == null) return null;
                byte[] bytes = new byte[s.Length];
                s.Read(bytes, 0, bytes.Length);
                return Assembly.Load(bytes);
            }
        }

        // Writes every "web/..." resource to DataDir\app and the native loader to DataDir.
        static void Unpack()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string res in asm.GetManifestResourceNames())
            {
                string target;
                if (res.StartsWith("web/")) target = Path.Combine(DataDir, "app", res.Substring(4).Replace('/', Path.DirectorySeparatorChar));
                else if (res == "native/WebView2Loader.dll") target = Path.Combine(DataDir, "WebView2Loader.dll");
                else continue;
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream s = asm.GetManifestResourceStream(res))
                using (MemoryStream ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    byte[] bytes = ms.ToArray();
                    if (File.Exists(target) && new FileInfo(target).Length == bytes.Length && SameBytes(File.ReadAllBytes(target), bytes)) continue;
                    try { File.WriteAllBytes(target, bytes); }
                    catch (IOException) { if (!File.Exists(target)) throw; } // loader DLL in use by another window
                }
            }
        }

        static bool SameBytes(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }
    }

    // Kept separate from Program so no WebView2 type is touched before AssemblyResolve is hooked.
    static class Shell
    {
        public static void Run()
        {
            Application.Run(new MainForm());
        }
    }

    class MainForm : Form
    {
        Microsoft.Web.WebView2.WinForms.WebView2 web;

        public MainForm()
        {
            Text = "Break Tool";
            Width = 1320;
            Height = 940;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(217, 208, 185);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            web = new Microsoft.Web.WebView2.WinForms.WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            Controls.Add(web);
            Load += OnLoad;
        }

        async void OnLoad(object sender, EventArgs e)
        {
            try
            {
                Microsoft.Web.WebView2.Core.CoreWebView2Environment.SetLoaderDllFolderPath(Program.DataDir);
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "webview"));
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsZoomControlEnabled = true;
                core.SetVirtualHostNameToFolderMapping("breaktool.local", Path.Combine(Program.DataDir, "app"),
                    Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);
                core.DocumentTitleChanged += delegate { Text = core.DocumentTitle; };
                core.Navigate("https://breaktool.local/index.html");
            }
            catch (Microsoft.Web.WebView2.Core.WebView2RuntimeNotFoundException)
            {
                if (MessageBox.Show("Break Tool needs the Microsoft Edge WebView2 Runtime (built into Windows 11).\n\nOpen the download page?",
                    "Break Tool", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    System.Diagnostics.Process.Start("https://developer.microsoft.com/microsoft-edge/webview2/");
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not start Break Tool:\n" + ex.Message, "Break Tool", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }
    }
}
