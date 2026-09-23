// Tiny SuperNova remote launcher — opens URL from config.txt (same folder as the .exe).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("SuperNova")]
[assembly: AssemblyDescription("SuperNova remote client — opens the shared web app")]
[assembly: AssemblyCompany("SuperNova")]
[assembly: AssemblyProduct("SuperNova Remote Client")]
[assembly: AssemblyCopyright("SuperNova")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string url = "http://91.99.15.48:8765/";
        string cfg = Path.Combine(dir, "config.txt");
        try
        {
            if (File.Exists(cfg))
            {
                foreach (string raw in File.ReadAllLines(cfg))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    if (line.StartsWith("URL=", StringComparison.OrdinalIgnoreCase))
                    {
                        url = line.Substring(4).Trim();
                    }
                }
            }
            if (string.IsNullOrWhiteSpace(url))
                url = "http://91.99.15.48:8765/";

            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Impossibile aprire SuperNova:\n" + ex.Message +
                "\n\nProva nel browser:\n" + url +
                "\n\nSe Windows blocca SuperNova.exe, usa Installa-su-Desktop.bat " +
                "(crea un collegamento senza .exe).",
                "SuperNova",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
