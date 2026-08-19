
export async function saveToSheets(url: string, data: { playerName: string; score: number; level: number }) {
  try {
    // Menggunakan URLSearchParams agar terbaca oleh e.parameter di Apps Script
    const params = new URLSearchParams();
    params.append('playerName', data.playerName);
    params.append('score', data.score.toString());
    params.append('level', data.level.toString());

    await fetch(url, {
      method: 'POST',
      mode: 'no-cors', // Penting agar tidak terblokir CORS
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    
    return true;
  } catch (error) {
    console.error('Error saving to sheets:', error);
    throw error;
  }
}
