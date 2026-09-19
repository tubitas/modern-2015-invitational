/* torneo.js — lógica del torneo compartida por admin.html, index.html y pantalla.html.
   Sin dependencias. El estado entero del torneo es un JSON que guarda torneo-api (Supabase):
   { nombre, config:{rondas_suizas, duracion_min, top, plazas}, jugadores:[{id,nombre,retirado}],
     rondas:[{n, tipo:'suiza'|'cuartos'|'semifinal'|'final', estado:'publicada'|'cerrada',
              temporizador:{duracion_min, fin, restante_ms}, mesas:[{mesa,a,b,ma,mb,ga,gb}]}],
     terminado }
   b = null es un bye (se apunta como 2-0). ma/mb son los slugs de los mazos. */
(function (root) {
  'use strict';
  var API = 'https://vxjaezmagjxfsjfskrjl.supabase.co/functions/v1/torneo-api';
  var ID = 'm2015';
  var offset = 0; // hora del servidor − hora local, para que el reloj no dependa del móvil

  function ahora() { return Date.now() + offset; }
  function ajustaReloj(d) { if (d && typeof d.ahora === 'number') offset = d.ahora - Date.now(); }

  /* ---------- API ---------- */
  function leer(k) {
    var u = API + '?t=' + ID + (k ? '&k=' + encodeURIComponent(k) : '') + '&_=' + Date.now();
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { ajustaReloj(d); return d; });
  }
  function guardar(k, version, estado, resumen) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: ID, k: k, version: version, estado: estado, resumen: resumen || null }) })
      .then(function (r) { return r.json().then(function (d) { d.status = r.status; return d; }); })
      .then(function (d) { ajustaReloj(d); if (d.status === 409) { d.conflicto = true; } return d; });
  }
  function historial(k) {
    return fetch(API + '?t=' + ID + '&historial=1&k=' + encodeURIComponent(k) + '&_=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function versionGuardada(k, v) {
    return fetch(API + '?t=' + ID + '&version=' + v + '&k=' + encodeURIComponent(k), { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  /* ---------- utilidades ---------- */
  function baraja(a) { a = a.slice(); for (var k = a.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = a[k]; a[k] = a[j]; a[j] = t; } return a; }
  function idNuevo() { return 'j' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6); }
  function nuevoEstado(nombre) {
    return { nombre: nombre || 'Modern 2015 Invitational', config: { rondas_suizas: 5, duracion_min: 50, top: 8, plazas: 20 }, jugadores: [], rondas: [], terminado: false };
  }
  function jugador(e, id) { for (var i = 0; i < e.jugadores.length; i++) if (e.jugadores[i].id === id) return e.jugadores[i]; return null; }
  function nombre(e, id) { var j = jugador(e, id); return j ? j.nombre : '—'; }
  function activos(e) { return e.jugadores.filter(function (j) { return !j.retirado; }); }
  function rondasSugeridas(n) { if (n <= 4) return 2; if (n <= 8) return 3; if (n <= 16) return 4; if (n <= 32) return 5; return 6; }

  /* ---------- fases ---------- */
  function rondaActual(e) { return e.rondas.length ? e.rondas[e.rondas.length - 1] : null; }
  function rondasCerradas(e) { return e.rondas.filter(function (r) { return r.estado === 'cerrada'; }); }
  function suizasCerradas(e) { return rondasCerradas(e).filter(function (r) { return r.tipo === 'suiza'; }).length; }
  function fase(e) {
    if (e.terminado) return 'fin';
    if (!e.rondas.length) return 'inscripcion';
    return rondaActual(e).tipo === 'suiza' ? 'suiza' : 'top';
  }
  // Qué toca generar a continuación (null = no queda nada; la ronda abierta bloquea).
  function siguienteTipo(e) {
    var r = rondaActual(e);
    if (r && r.estado !== 'cerrada') return null;
    if (e.terminado) return null;
    if (suizasCerradas(e) < e.config.rondas_suizas) return 'suiza';
    var top = +e.config.top || 0;
    if (!top) return null;
    var tipos = e.rondas.map(function (x) { return x.tipo; });
    if (top >= 8 && tipos.indexOf('cuartos') < 0) return 'cuartos';
    if (top >= 4 && tipos.indexOf('semifinal') < 0) return 'semifinal';
    if (tipos.indexOf('final') < 0) return 'final';
    return null;
  }
  function nombreRonda(r) {
    if (!r) return '';
    if (r.tipo === 'suiza') return 'Ronda ' + r.n;
    return { cuartos: 'Cuartos de final', semifinal: 'Semifinales', final: 'Final' }[r.tipo] || r.tipo;
  }
  function nombreTipo(t, n) { return nombreRonda({ tipo: t, n: n }); }

  /* ---------- clasificación (solo rondas suizas cerradas) ---------- */
  function comparar(a, b) {
    return (b.pm - a.pm) || (b.omw - a.omw) || (b.gw - a.gw) || (b.ogw - a.ogw) || a.nombre.localeCompare(b.nombre, 'es');
  }
  function clasificacion(e) {
    var st = {};
    e.jugadores.forEach(function (j) {
      st[j.id] = { id: j.id, nombre: j.nombre, retirado: !!j.retirado, pm: 0, pg: 0, pj: 0, rondas: 0, rivales: [], byes: 0, v: 0, d: 0, x: 0, mazos: [] };
    });
    rondasCerradas(e).forEach(function (r) {
      if (r.tipo !== 'suiza') return;
      r.mesas.forEach(function (m) {
        var A = st[m.a], B = m.b ? st[m.b] : null;
        if (!A) return;
        if (!B) { A.pm += 3; A.rondas++; A.byes++; A.v++; A.pg += 2; A.pj += 2; return; } // bye = 2-0
        if (m.ga == null || m.gb == null) return;
        A.rondas++; B.rondas++; A.rivales.push(B.id); B.rivales.push(A.id);
        A.pg += m.ga; B.pg += m.gb; A.pj += m.ga + m.gb; B.pj += m.ga + m.gb;
        if (m.ga > m.gb) { A.pm += 3; A.v++; B.d++; }
        else if (m.gb > m.ga) { B.pm += 3; B.v++; A.d++; }
        else { A.pm += 1; B.pm += 1; A.x++; B.x++; }
      });
    });
    // mazos jugados (todas las rondas, también la abierta): para que nadie repita y para enseñarlo
    e.rondas.forEach(function (r) { r.mesas.forEach(function (m) {
      if (m.a && m.ma && st[m.a]) st[m.a].mazos.push(m.ma);
      if (m.b && m.mb && st[m.b]) st[m.b].mazos.push(m.mb);
    }); });
    var lista = Object.keys(st).map(function (id) { return st[id]; });
    lista.forEach(function (j) {
      j.mw = j.rondas ? Math.max(1 / 3, j.pm / (3 * j.rondas)) : 0;
      j.gw = j.pj ? Math.max(1 / 3, j.pg / j.pj) : 0;
    });
    lista.forEach(function (j) {
      if (!j.rivales.length) { j.omw = 0; j.ogw = 0; return; }
      var so = 0, sg = 0;
      j.rivales.forEach(function (id) { so += st[id].mw; sg += st[id].gw; });
      j.omw = so / j.rivales.length; j.ogw = sg / j.rivales.length;
    });
    lista.sort(comparar);
    lista.forEach(function (j, i) { j.pos = i + 1; });
    return lista;
  }
  function tuvoBye(e, id) {
    return e.rondas.some(function (r) { return r.mesas.some(function (m) { return m.a === id && !m.b; }); });
  }
  function rivalesPrevios(e) {
    var p = {};
    e.rondas.forEach(function (r) { r.mesas.forEach(function (m) {
      if (!m.a || !m.b) return;
      (p[m.a] = p[m.a] || {})[m.b] = true; (p[m.b] = p[m.b] || {})[m.a] = true;
    }); });
    return p;
  }
  function ganador(m) {
    if (!m.b) return m.a;
    if (m.ga == null || m.gb == null || m.ga === m.gb) return null;
    return m.ga > m.gb ? m.a : m.b;
  }
  function perdedor(m) { var g = ganador(m); if (!g || !m.b) return null; return g === m.a ? m.b : m.a; }

  // Clasificación final: la suiza, reordenada por lo que pasó en el Top.
  function clasificacionFinal(e) {
    var cl = clasificacion(e);
    var top = rondasCerradas(e).filter(function (r) { return r.tipo !== 'suiza'; });
    if (!top.length) return cl;
    var rango = {}; // id → 1 campeón, 2 finalista, 3 semifinalista, 5 cuartofinalista
    top.forEach(function (r) { r.mesas.forEach(function (m) {
      var g = ganador(m), p = perdedor(m);
      if (r.tipo === 'final') { if (g) rango[g] = 1; if (p) rango[p] = 2; }
      else if (r.tipo === 'semifinal') { if (p) rango[p] = 3; if (g && !rango[g]) rango[g] = 2.5; }
      else if (r.tipo === 'cuartos') { if (p) rango[p] = 5; if (g && !rango[g]) rango[g] = 4.5; }
    }); });
    var pos = {}; cl.forEach(function (j) { pos[j.id] = j.pos; });
    cl.sort(function (a, b) { return ((rango[a.id] || 99) - (rango[b.id] || 99)) || (pos[a.id] - pos[b.id]); });
    cl.forEach(function (j, i) { j.pos = i + 1; j.rango = rango[j.id] || null; });
    return cl;
  }

  /* ---------- emparejar ---------- */
  // Emparejamiento suizo por ranking: la ronda 1 al azar; después, con la clasificación completa
  // (puntos y desempates) el 1.º juega contra el 2.º, el 3.º contra el 4.º… saltando a quien ya
  // se haya enfrentado. La mesa 1 es la del mejor clasificado. Bye al último sin bye previo.
  function emparejarSuiza(e) {
    var cl = clasificacion(e).filter(function (j) { return !j.retirado; });
    var n = e.rondas.filter(function (r) { return r.tipo === 'suiza'; }).length + 1;
    var orden = n === 1 ? baraja(cl) : cl;
    var ids = orden.map(function (j) { return j.id; });
    var previos = rivalesPrevios(e);
    function empareja(lista) {
      if (!lista.length) return [];
      var a = lista[0];
      for (var i = 1; i < lista.length; i++) {
        var b = lista[i];
        if (previos[a] && previos[a][b]) continue;
        var resto = lista.slice(1); resto.splice(i - 1, 1);
        var r = empareja(resto);
        if (r) return [[a, b]].concat(r);
      }
      return null;
    }
    var bye = null, pares = null;
    if (ids.length % 2 === 1) {
      var candidatos = ids.slice().reverse().filter(function (id) { return !tuvoBye(e, id); });
      if (!candidatos.length) candidatos = ids.slice().reverse();
      for (var c = 0; c < candidatos.length && !pares; c++) {
        var sin = ids.filter(function (id) { return id !== candidatos[c]; });
        pares = empareja(sin);
        if (pares) bye = candidatos[c];
      }
      if (!pares) { bye = ids[ids.length - 1]; pares = null; ids = ids.slice(0, -1); }
    } else pares = empareja(ids);
    if (!pares) { // no hay forma de evitar repeticiones: se empareja en orden
      pares = []; var lista = ids.filter(function (id) { return id !== bye; });
      for (var k = 0; k + 1 < lista.length; k += 2) pares.push([lista[k], lista[k + 1]]);
    }
    var mesas = pares.map(function (p, i) { return { mesa: i + 1, a: p[0], b: p[1], ma: null, mb: null, ga: null, gb: null }; });
    if (bye) mesas.push({ mesa: mesas.length + 1, a: bye, b: null, ma: null, mb: null, ga: 2, gb: 0 });
    return { n: n, tipo: 'suiza', estado: 'publicada', temporizador: { duracion_min: e.config.duracion_min, fin: null, restante_ms: null }, mesas: mesas };
  }
  // Top 8/4/2: cuartos 1-8, 2-7, 3-6, 4-5 sobre la clasificación suiza; luego ganadores.
  function emparejarTop(e, tipo) {
    var mesas = [], n = e.rondas.length + 1;
    if (tipo === 'cuartos' || (tipo === 'semifinal' && +e.config.top === 4) || (tipo === 'final' && +e.config.top === 2)) {
      var top = +e.config.top;
      var cl = clasificacion(e).filter(function (j) { return !j.retirado; }).slice(0, top);
      for (var i = 0; i < cl.length / 2; i++) {
        var b = cl[cl.length - 1 - i];
        mesas.push({ mesa: i + 1, a: cl[i].id, b: b ? b.id : null, ma: null, mb: null, ga: b ? null : 2, gb: b ? null : 0 });
      }
    } else {
      var previa = rondasCerradas(e).filter(function (r) { return r.tipo === (tipo === 'final' ? 'semifinal' : 'cuartos'); }).pop();
      var g = previa.mesas.map(ganador);
      if (tipo === 'semifinal') { mesas.push({ mesa: 1, a: g[0], b: g[3] }); mesas.push({ mesa: 2, a: g[1], b: g[2] }); }
      else mesas.push({ mesa: 1, a: g[0], b: g[1] });
      mesas.forEach(function (m) { m.ma = null; m.mb = null; m.ga = null; m.gb = null; });
    }
    return { n: n, tipo: tipo, estado: 'publicada', temporizador: { duracion_min: e.config.duracion_min, fin: null, restante_ms: null }, mesas: mesas };
  }
  function emparejar(e, tipo) { return tipo === 'suiza' ? emparejarSuiza(e) : emparejarTop(e, tipo); }

  /* ---------- mazos: nadie repite en todo el torneo ---------- */
  function mazosJugados(e, id, salvoRonda) {
    var s = {};
    e.rondas.forEach(function (r) { if (r === salvoRonda) return; r.mesas.forEach(function (m) {
      if (m.a === id && m.ma) s[m.ma] = true;
      if (m.b === id && m.mb) s[m.mb] = true;
    }); });
    return s;
  }
  // Reparte los mazos de `slugs` entre los que juegan en `ronda` sin que nadie repita.
  function asignarMazos(e, ronda, slugs) {
    var jugadores = [];
    ronda.mesas.forEach(function (m) { if (m.a && m.b) { jugadores.push(m.a); jugadores.push(m.b); } });
    var usados = {}; jugadores.forEach(function (id) { usados[id] = mazosJugados(e, id, ronda); });
    var orden = baraja(jugadores), asign = {}, libres = {};
    slugs.forEach(function (s) { libres[s] = true; });
    function rec(i) {
      if (i === orden.length) return true;
      var id = orden[i];
      var cand = baraja(slugs.filter(function (s) { return libres[s] && !usados[id][s]; }));
      for (var c = 0; c < cand.length; c++) {
        asign[id] = cand[c]; libres[cand[c]] = false;
        if (rec(i + 1)) return true;
        libres[cand[c]] = true; delete asign[id];
      }
      return false;
    }
    var ok = rec(0);
    if (!ok) { // no debería pasar con 20 mazos y 8 rondas; si pasa, se reparte lo que quede
      orden.forEach(function (id) { if (!asign[id]) { var s = slugs.filter(function (x) { return libres[x]; })[0]; if (s) { asign[id] = s; libres[s] = false; } } });
    }
    ronda.mesas.forEach(function (m) { m.ma = m.b ? asign[m.a] || null : null; m.mb = m.b ? asign[m.b] || null : null; });
    return ok;
  }
  // Mazos que puede llevar `id` en `ronda`: ni jugados antes ni cogidos ya en esta ronda por otro.
  function mazosPosibles(e, ronda, id, slugs) {
    var usados = mazosJugados(e, id, ronda), enRonda = {};
    ronda.mesas.forEach(function (m) { if (m.a !== id && m.ma) enRonda[m.ma] = true; if (m.b !== id && m.mb) enRonda[m.mb] = true; });
    return slugs.filter(function (s) { return !usados[s] && !enRonda[s]; });
  }

  /* ---------- resultados ---------- */
  function resultadosCompletos(r) { return r.mesas.every(function (m) { return !m.b || (m.ga != null && m.gb != null); }); }
  function empatesEnTop(r) { return r.tipo !== 'suiza' && r.mesas.some(function (m) { return m.b && m.ga != null && m.ga === m.gb; }); }

  /* ---------- temporizador ---------- */
  function restante(r) {
    var t = r && r.temporizador; if (!t) return null;
    if (t.fin) return t.fin - ahora();
    if (t.restante_ms != null) return t.restante_ms;
    return null;
  }
  function estadoTemporizador(r) {
    var t = r && r.temporizador; if (!t) return 'sin';
    if (t.fin) return 'corriendo';
    if (t.restante_ms != null) return 'pausado';
    return 'sin';
  }
  function fmt(ms) {
    var neg = ms < 0; ms = Math.abs(ms);
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60); s = s % 60;
    return (neg ? '−' : '') + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function pct(x) { return (x * 100).toFixed(1).replace('.', ',') + ' %'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  root.Torneo = {
    API: API, ID: ID, ahora: ahora, leer: leer, guardar: guardar, historial: historial, versionGuardada: versionGuardada,
    baraja: baraja, idNuevo: idNuevo, nuevoEstado: nuevoEstado, jugador: jugador, nombre: nombre, activos: activos, rondasSugeridas: rondasSugeridas,
    rondaActual: rondaActual, rondasCerradas: rondasCerradas, suizasCerradas: suizasCerradas, fase: fase, siguienteTipo: siguienteTipo, nombreRonda: nombreRonda, nombreTipo: nombreTipo,
    clasificacion: clasificacion, clasificacionFinal: clasificacionFinal, ganador: ganador, perdedor: perdedor,
    emparejar: emparejar, asignarMazos: asignarMazos, mazosJugados: mazosJugados, mazosPosibles: mazosPosibles,
    resultadosCompletos: resultadosCompletos, empatesEnTop: empatesEnTop,
    restante: restante, estadoTemporizador: estadoTemporizador, fmt: fmt, pct: pct, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
