// ==UserScript==
// @name         Hub Heroes Pulse Dashboard
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Dashboard completo con todas las submissions del survey
// @author       mrenmk
// @match        https://admin.pulse.aws/survey/Survey-3A6qjYlsZrSbvUBBCkFcPpFPLi1*
// @updateURL    https://raw.githubusercontent.com/mrenmk/tampermonkey/main/hub_heroes_pulse_dashboard.user.js
// @downloadURL  https://raw.githubusercontent.com/mrenmk/tampermonkey/main/hub_heroes_pulse_dashboard.user.js
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
// ==/UserScript==

(function() {
    'use strict';

    let allSubmissions = [];
    let filteredSubmissions = [];
    let isLoading = false;
    let chartInstances = { reason: null, packages: null };
    let currentTheme = 'light';

    // Paletas de colores para cada tema
    const THEMES = {
        light: {
            background: '#FFFFFF',
            text: '#232F3E',
            textSecondary: '#687078',
            cardBg: '#F2F2F2',
            border: '#ddd',
            headerBorder: '#146EB4',
            tableHeaderBg: '#232F3E',
            tableHeaderText: '#FFFFFF',
            tableRowEven: '#FFFFFF',
            tableRowOdd: '#F2F2F2',
            inputBg: '#FFFFFF',
            dropdownBg: '#FFFFFF'
        },
        dark: {
            background: '#0F1B2A',
            text: '#FFFFFF',
            textSecondary: '#8996A9',
            cardBg: '#16202D',
            border: '#2D3F54',
            headerBorder: '#146EB4',
            tableHeaderBg: '#0D1117',
            tableHeaderText: '#FFFFFF',
            tableRowEven: '#16202D',
            tableRowOdd: '#1A2633',
            inputBg: '#1A2633',
            dropdownBg: '#16202D'
        }
    };

    const SURVEY_ID = 'Survey-3A6qjYlsZrSbvUBBCkFcPpFPLi1';
    const PAGE_SIZE = 50;

    // Función para detectar el tema actual
    function getCurrentTheme() {
        try {
            const themeData = localStorage.getItem('theme');
            if (themeData) {
                const theme = JSON.parse(themeData);
                return theme?.state?.theme || 'light';
            }
        } catch (e) {
            console.warn('Error detecting theme:', e);
        }
        return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }

    // Mapeo de field IDs a nombres de columnas
    const FIELD_MAP = {
        'cee8f366-d875-464e-8059-fb3f8dc38bc1': 'login',
        '9c2379ec-8160-4d07-9ede-d71cfc7f1ec3': 'store',
        '6999423f-d1d0-4d53-b384-1ae8d241e98c': 'totalVolume',
        'a480f5e1-4cf0-4f76-b7e4-33ee6b42ccf5': 'packagesDropped',
        '66c37203-eadd-4ab8-b85c-75ff2a9313c0': 'hubHeroes',
        '05b6d15a-1832-40ff-87e4-a65260386504': 'packagesSaved',
        '007d77fa-d7a0-40d9-9300-2d6a482c6ce8': 'reason',
        '78b2467c-b230-45ff-a70a-fa64336d2a2f': 'station',
        'befbc3b8-0330-4b0c-a981-9e1a72a697d2': 'openTicket'
    };

    // Función para extraer el token de autorización
    function getAuthToken() {
        // Intentar obtener del localStorage (CurrentUser)
        try {
            const currentUser = localStorage.getItem('CurrentUser');
            if (currentUser) {
                const userData = JSON.parse(currentUser);
                const token = userData?.state?.user?.accessToken;
                if (token) return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
            }
        } catch (e) {
            console.warn('Error parsing CurrentUser from localStorage:', e);
        }
        
        // Buscar en las cookies
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            if (cookie.includes('auth_token')) {
                const token = cookie.split('=')[1].trim();
                return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
            }
        }

        // Token hardcoded como fallback (probablemente expirado)
        return 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXIiOjEsImlzcyI6Imh0dHBzOi8vYXBpLnB1bHNlLmF3cyIsInN1YiI6Im1yZW5tayIsInVzZXJuYW1lIjoibXJlbm1rIiwiZXhwIjoxNzcyNjI0NDQ3LCJyb2xlIjoic3RhZmYiLCJpYXQiOjE3NzI2MTAwNDd9.uGI8wBpJMPsYDFlRmvt2mfecA17ipCwiB3DgpdTNK-Q';
    }

    // Función para iniciar un job de paginación
    async function startPaginationJob(pageNumber) {
        const token = getAuthToken();

        const query = `query startSurveySubmissionsPaginateJob($surveyId: String!, $pageSize: Int!, $initialPageNumber: Int, $filters: [AttributeFilter!]) {
            jobId: startSurveySubmissionsPaginateJob(
                surveyId: $surveyId
                pageSize: $pageSize
                initialPageNumber: $initialPageNumber
                filters: $filters
            )
        }`;

        const response = await fetch('https://api.pulse.aws/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'authorization': token,
                'admin-version': '2',
                'x-app-id': 'Admin'
            },
            body: JSON.stringify({
                operationName: 'startSurveySubmissionsPaginateJob',
                query: query,
                variables: {
                    surveyId: SURVEY_ID,
                    pageSize: PAGE_SIZE,
                    initialPageNumber: pageNumber,
                    filters: []
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.data.jobId;
    }

    // Función para obtener el estado del job
    async function getJobStatus(jobId) {
        const token = getAuthToken();

        const query = `query getSurveySubmissionsPaginateJobStatus($jobId: String!) {
            jobStatus: getSurveySubmissionsPaginateJobStatus(jobId: $jobId) {
                jobId
                status
                startDate
                stopDate
                result {
                    totalItemCount
                    pageSize
                    items {
                        id
                        createdOn
                        fieldIdToResponseMap
                        relatedResources {
                            reason
                            url
                        }
                    }
                    pageNumber
                }
            }
        }`;

        const response = await fetch('https://api.pulse.aws/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'authorization': token,
                'admin-version': '2',
                'x-app-id': 'Admin'
            },
            body: JSON.stringify({
                operationName: 'getSurveySubmissionsPaginateJobStatus',
                query: query,
                variables: {
                    jobId: jobId
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.data.jobStatus;
    }

    // Función para esperar a que el job termine
    async function waitForJob(jobId, maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            const status = await getJobStatus(jobId);

            if (status.status === 'SUCCEEDED') {
                return status.result;
            } else if (status.status === 'FAILED') {
                throw new Error('Job failed');
            }

            // Esperar 500ms antes de reintentar
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        throw new Error('Job timeout');
    }

    // Función para transformar los datos de la API
    function transformSubmission(item) {
        const submission = {
            id: item.id,
            submissionDate: item.createdOn,
            ticket: item.relatedResources && item.relatedResources.length > 0
                ? item.relatedResources.url
                : null
        };

        // Extraer respuestas del fieldIdToResponseMap
        for (const [fieldId, fieldData] of Object.entries(item.fieldIdToResponseMap || {})) {
            const fieldName = FIELD_MAP[fieldId];
            if (fieldName && fieldData.response) {
                submission[fieldName] = fieldData.response;
            }
        }

        return submission;
    }

    // Función para obtener todas las submissions
    async function fetchAllSubmissions() {
        allSubmissions = [];

        // Iniciar el primer job para saber cuántas páginas hay
        const firstJobId = await startPaginationJob(1);
        const firstResult = await waitForJob(firstJobId);

        const totalItems = firstResult.totalItemCount;
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);

        console.log(`Total items: ${totalItems}, Total pages: ${totalPages}`);

        // Procesar la primera página
        firstResult.items.forEach(item => {
            allSubmissions.push(transformSubmission(item));
        });

        // Obtener el resto de páginas
        const jobPromises = [];
        for (let page = 2; page <= totalPages; page++) {
            jobPromises.push(
                startPaginationJob(page)
                    .then(jobId => waitForJob(jobId))
                    .then(result => {
                        result.items.forEach(item => {
                            allSubmissions.push(transformSubmission(item));
                        });
                    })
            );
        }

        await Promise.all(jobPromises);

        console.log(`Loaded ${allSubmissions.length} submissions`);
        return allSubmissions;
    }

    // Función para añadir tab Dashboard
    function addDashboardTab() {
        // Buscar el tab Settings para obtener el contenedor
        const settingsTab = document.querySelector('[data-testid="Settings-tab"]');
        if (!settingsTab || document.getElementById('dashboard-tab')) return;

        const tabContainer = settingsTab.parentElement;

        // Crear el tab Dashboard
        const dashboardTab = document.createElement('a');
        dashboardTab.id = 'dashboard-tab';
        dashboardTab.className = 'border-transparent text-gray-500 dark:text-[#8996A9] hover:border-foreground hover:text-foreground border-b-2 py-2 px-1 text-center text-sm font-medium no-underline cursor-pointer';
        dashboardTab.textContent = 'Dashboard';

        // Insertar después del tab Settings
        settingsTab.parentNode.insertBefore(dashboardTab, settingsTab.nextSibling);

        // Event listener para cargar dashboard
        dashboardTab.addEventListener('click', async (e) => {
            e.preventDefault();
            if (isLoading || document.getElementById('custom-dashboard')) return;

            isLoading = true;
            dashboardTab.textContent = '⏳ Loading...';

            try {
                await fetchAllSubmissions();
                activateDashboardTab();
                createDashboard();
            } catch (error) {
                console.error('Error loading submissions:', error);
                alert('Error al cargar las submissions. Revisa la consola para más detalles.');
                dashboardTab.textContent = 'Dashboard';
            }

            isLoading = false;
        });
    }

    // Función para activar visualmente el tab Dashboard
    function activateDashboardTab() {
        const dashboardTab = document.getElementById('dashboard-tab');
        if (!dashboardTab) return;

        dashboardTab.className = 'border-foreground text-foreground border-b-2 py-2 px-1 text-center text-sm font-medium no-underline cursor-pointer';
        dashboardTab.textContent = 'Dashboard';
    }

    // Función para desactivar visualmente el tab Dashboard
    function deactivateDashboardTab() {
        const dashboardTab = document.getElementById('dashboard-tab');
        if (!dashboardTab) return;

        dashboardTab.className = 'border-transparent text-gray-500 dark:text-[#8996A9] hover:border-foreground hover:text-foreground border-b-2 py-2 px-1 text-center text-sm font-medium no-underline cursor-pointer';
    }
    // Función para crear el dashboard
    function createDashboard() {
        // Detectar tema actual
        currentTheme = getCurrentTheme();
        const theme = THEMES[currentTheme];

        // Crear contenedor principal del dashboard
        const dashboardContainer = document.createElement('div');
        dashboardContainer.id = 'custom-dashboard';
        dashboardContainer.style.cssText = `
            position: fixed;
            left: 288px;
            top: 0;
            right: 0;
            height: 100vh;
            background: ${theme.background};
            color: ${theme.text};
            box-shadow: -2px 0 10px rgba(0,0,0,0.1);
            overflow-y: auto;
            z-index: 9999;
            padding: 20px;
        `;

        // Header con botones
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #146EB4;
        `;

        const headerTitle = document.createElement('h2');
        headerTitle.textContent = 'Hub Heroes Dashboard';
        headerTitle.style.cssText = `margin: 0; color: ${theme.text};`;

        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = 'display: flex; gap: 10px;';

        const updateButton = document.createElement('button');
        updateButton.textContent = 'Update';
        updateButton.id = 'update-button';
        updateButton.style.cssText = `
            background: #146EB4;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
        `;

        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download CSV';
        downloadButton.style.cssText = `
            background: #232F3E;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
        `;

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.cssText = `
            background: #FF9900;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            font-weight: bold;
        `;

        buttonsContainer.appendChild(updateButton);
        buttonsContainer.appendChild(downloadButton);
        buttonsContainer.appendChild(closeButton);

        header.appendChild(headerTitle);
        header.appendChild(buttonsContainer);

        // Sección de filtros
        const filtersSection = document.createElement('div');
        filtersSection.style.cssText = `
            background: ${theme.cardBg};
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        `;

        // Extraer valores únicos para dropdown de Reason
        const uniqueReasons = [...new Set(allSubmissions.map(s => s.reason).filter(Boolean))].sort();

        filtersSection.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">Start Date:</label>
                    <input type="date" id="filter-date-start" style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text};">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">End Date:</label>
                    <input type="date" id="filter-date-end" style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text};">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">Station (starts with):</label>
                    <input type="text" id="filter-station" placeholder="Type to filter..." style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text};">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">Login (starts with):</label>
                    <input type="text" id="filter-login" placeholder="Type to filter..." style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text};">
                </div>
                <div style="position: relative;">
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">Reason:</label>
                    <input type="text" id="filter-reason-display" readonly placeholder="Select..." style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; cursor: pointer; background: ${theme.inputBg}; color: ${theme.text};">
                    <div id="reason-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: ${theme.dropdownBg}; border: 1px solid ${theme.border}; border-radius: 4px; margin-top: 2px; max-height: 250px; overflow-y: auto; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
                        <div style="padding: 10px; border-bottom: 1px solid ${theme.border};">
                            ${uniqueReasons.map(r => `
                                <label style="display: block; padding: 5px; cursor: pointer; user-select: none; color: ${theme.text};">
                                    <input type="checkbox" value="${r}" class="reason-checkbox" style="margin-right: 8px;">
                                    ${r}
                                </label>
                            `).join('')}
                        </div>
                        <div style="padding: 10px; text-align: right; border-top: 1px solid ${theme.border};">
                            <button id="apply-reason-filter" style="background: #146EB4; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px; font-weight: bold;">Apply</button>
                        </div>
                    </div>
                </div>
                <div>
                    <label style="display: block; margin-bottom: 5px; font-weight: bold; color: ${theme.text};">Store (starts with):</label>
                    <input type="text" id="filter-store" placeholder="Type to filter..." style="width: 100%; padding: 8px; border: 1px solid ${theme.border}; border-radius: 4px; background: ${theme.inputBg}; color: ${theme.text};">
                </div>
            </div>
            <button id="clear-filters" style="background: #232F3E; color: white; border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px; font-weight: bold;">Clear Filters</button>
        `;

        // Sección de métricas agregadas
        const metricsSection = document.createElement('div');
        metricsSection.style.cssText = `
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
        `;

        metricsSection.id = 'metrics-section';

        // Sección de gráficos y tabla de stations
        const chartsSection = document.createElement('div');
        chartsSection.style.cssText = `
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
        `;

        const tableChartContainer = document.createElement('div');
        tableChartContainer.style.cssText = `flex: 1; background: ${theme.cardBg}; padding: 15px; border-radius: 8px; max-height: 300px; overflow-y: auto;`;
        tableChartContainer.innerHTML = `
            <h3 style="margin: 0 0 10px 0; font-size: 16px; font-weight: bold; text-align: center; color: ${theme.text};">Stations Summary</h3>
            <table id="stationsTable" style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead style="position: sticky; top: 0; background: ${theme.tableHeaderBg}; color: ${theme.tableHeaderText}; z-index: 10;">
                    <tr>
                        <th style="padding: 8px; text-align: left; border: 1px solid ${theme.border};">Station</th>
                        <th style="padding: 8px; text-align: right; border: 1px solid ${theme.border};">Packages Not Saved</th>
                        <th style="padding: 8px; text-align: left; border: 1px solid ${theme.border};">Stores & Reason</th>
                    </tr>
                </thead>
                <tbody id="stations-tbody"></tbody>
            </table>
        `;

        const chartContainer1 = document.createElement('div');
        chartContainer1.style.cssText = `flex: 1; background: ${theme.cardBg}; padding: 15px; border-radius: 8px; max-height: 300px;`;
        chartContainer1.innerHTML = '<canvas id="reasonChart"></canvas>';

        const chartContainer2 = document.createElement('div');
        chartContainer2.style.cssText = `flex: 1; background: ${theme.cardBg}; padding: 15px; border-radius: 8px; max-height: 300px;`;
        chartContainer2.innerHTML = '<canvas id="packagesChart"></canvas>';

        chartsSection.appendChild(tableChartContainer);
        chartsSection.appendChild(chartContainer1);
        chartsSection.appendChild(chartContainer2);

        // Tabla de datos
        const tableContainer = document.createElement('div');
        tableContainer.style.cssText = `
            background: ${theme.cardBg};
            border-radius: 8px;
            overflow-x: auto;
        `;

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        `;

        // Header de la tabla con sticky
        table.innerHTML = `
            <thead style="position: sticky; top: 0; z-index: 100; background: ${theme.tableHeaderBg};">
                <tr style="background: ${theme.tableHeaderBg}; color: ${theme.tableHeaderText};">
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Submission Date</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Login</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Store</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid ${theme.border};">Total Volume</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid ${theme.border};">Packages Dropped</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid ${theme.border};">Hub Heroes</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid ${theme.border};">Packages Saved</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Reason</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Station</th>
                    <th style="padding: 12px; text-align: left; border: 1px solid ${theme.border};">Open Ticket?</th>
                </tr>
            </thead>
            <tbody id="submissions-tbody"></tbody>
        `;

        tableContainer.appendChild(table);

        // Ensamblar dashboard
        dashboardContainer.appendChild(header);
        dashboardContainer.appendChild(filtersSection);
        dashboardContainer.appendChild(metricsSection);
        dashboardContainer.appendChild(chartsSection);
        dashboardContainer.appendChild(tableContainer);
        document.body.appendChild(dashboardContainer);

        // Inicializar con todos los datos
        filteredSubmissions = [...allSubmissions];
        updateDashboard();

        // Event listeners para filtros
        document.getElementById('filter-date-start').addEventListener('change', applyFilters);
        document.getElementById('filter-date-end').addEventListener('change', applyFilters);
        document.getElementById('filter-station').addEventListener('input', applyFilters);
        document.getElementById('filter-login').addEventListener('input', applyFilters);
        document.getElementById('filter-store').addEventListener('input', applyFilters);

        // Dropdown personalizado para Reason
        const reasonDisplay = document.getElementById('filter-reason-display');
        const reasonDropdown = document.getElementById('reason-dropdown');

        reasonDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            reasonDropdown.style.display = reasonDropdown.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('apply-reason-filter').addEventListener('click', () => {
            const selected = Array.from(document.querySelectorAll('.reason-checkbox:checked')).map(cb => cb.value);
            reasonDisplay.value = selected.length > 0 ? `${selected.length} selected` : '';
            reasonDropdown.style.display = 'none';
            applyFilters();
        });

        // Cerrar dropdown al hacer click fuera
        document.addEventListener('click', (e) => {
            if (!reasonDropdown.contains(e.target) && e.target !== reasonDisplay) {
                reasonDropdown.style.display = 'none';
            }
        });

        document.getElementById('clear-filters').addEventListener('click', () => {
            document.getElementById('filter-date-start').value = '';
            document.getElementById('filter-date-end').value = '';
            document.getElementById('filter-station').value = '';
            document.getElementById('filter-login').value = '';
            document.getElementById('filter-reason-display').value = '';
            document.querySelectorAll('.reason-checkbox').forEach(cb => cb.checked = false);
            document.getElementById('filter-store').value = '';
            applyFilters();
        });

        // Event listener para Update
        updateButton.addEventListener('click', async function() {
            updateButton.disabled = true;
            updateButton.textContent = '⏳ Updating...';
            try {
                await fetchAllSubmissions();
                applyFilters();
            } catch (error) {
                console.error('Error updating submissions:', error);
                alert('Error updating data. Check console for details.');
            }
            updateButton.disabled = false;
            updateButton.textContent = 'Update';
        });

        // Event listener para Download CSV
        downloadButton.addEventListener('click', function() {
            downloadCSV();
        });

        // Event listener para cerrar
        closeButton.addEventListener('click', function() {
            dashboardContainer.remove();
            deactivateDashboardTab();
        });

        // Observar cambios de tema
        const themeObserver = new MutationObserver(() => {
            const newTheme = getCurrentTheme();
            if (newTheme !== currentTheme) {
                currentTheme = newTheme;
                const dashboard = document.getElementById('custom-dashboard');
                if (dashboard) {
                    dashboard.remove();
                    createDashboard();
                }
            }
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

        window.addEventListener('storage', (e) => {
            if (e.key === 'theme') {
                const newTheme = getCurrentTheme();
                if (newTheme !== currentTheme) {
                    currentTheme = newTheme;
                    const dashboard = document.getElementById('custom-dashboard');
                    if (dashboard) {
                        dashboard.remove();
                        createDashboard();
                    }
                }
            }
        });
    }

    // Función para aplicar filtros
    function applyFilters() {
        const dateStart = document.getElementById('filter-date-start').value;
        const dateEnd = document.getElementById('filter-date-end').value;
        const stationFilter = document.getElementById('filter-station').value.toLowerCase();
        const loginFilter = document.getElementById('filter-login').value.toLowerCase();
        const selectedReasons = Array.from(document.querySelectorAll('.reason-checkbox:checked')).map(cb => cb.value);
        const storeFilter = document.getElementById('filter-store').value.toLowerCase();

        filteredSubmissions = allSubmissions.filter(s => {
            // Filtro de fecha
            if (dateStart || dateEnd) {
                const subDate = s.submissionDate ? new Date(s.submissionDate).toISOString().split('T')[0] : null;
                if (!subDate) return false;
                if (dateStart && subDate < dateStart) return false;
                if (dateEnd && subDate > dateEnd) return false;
            }

            // Filtro de station (starts with)
            if (stationFilter && !(s.station || '').toLowerCase().startsWith(stationFilter)) return false;

            // Filtro de login (starts with)
            if (loginFilter && !(s.login || '').toLowerCase().startsWith(loginFilter)) return false;

            // Filtro de reason (multichoice)
            if (selectedReasons.length > 0 && !selectedReasons.includes(s.reason)) return false;

            // Filtro de store (starts with)
            if (storeFilter && !(s.store || '').toLowerCase().startsWith(storeFilter)) return false;

            return true;
        });

        updateDashboard();
    }

    // Función para actualizar el dashboard con datos filtrados
    function updateDashboard() {
        const theme = THEMES[currentTheme];
        
        // Actualizar métricas
        const totalPackagesDropped = filteredSubmissions.reduce((sum, s) => sum + (parseInt(s.packagesDropped) || 0), 0);
        const totalPackagesSaved = filteredSubmissions.reduce((sum, s) => sum + (parseInt(s.packagesSaved) || 0), 0);
        const totalSubmissions = filteredSubmissions.length;

        document.getElementById('metrics-section').innerHTML = `
            <div style="flex: 1; background: ${theme.cardBg}; padding: 20px; border-radius: 8px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: ${theme.text};">${totalSubmissions}</div>
                <div style="color: #146EB4; margin-top: 5px;">Total Submissions</div>
            </div>
            <div style="flex: 1; background: ${theme.cardBg}; padding: 20px; border-radius: 8px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #FF9900;">${totalPackagesDropped}</div>
                <div style="color: #146EB4; margin-top: 5px;">Packages Dropped</div>
            </div>
            <div style="flex: 1; background: ${theme.cardBg}; padding: 20px; border-radius: 8px; text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #146EB4;">${totalPackagesSaved}</div>
                <div style="color: #146EB4; margin-top: 5px;">Packages Saved</div>
            </div>
        `;

        // Actualizar tabla
        const tbody = document.getElementById('submissions-tbody');
        tbody.innerHTML = '';

        const formatDate = (dateStr) => {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleString('es-ES', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        filteredSubmissions.forEach((submission, index) => {
            const row = document.createElement('tr');
            row.style.cssText = `background: ${index % 2 === 0 ? theme.tableRowEven : theme.tableRowOdd}; color: ${theme.text};`;
            row.innerHTML = `
                <td style="padding: 10px; border: 1px solid ${theme.border};">${formatDate(submission.submissionDate)}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border};">${submission.login || '-'}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border};">${submission.store || '-'}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border}; text-align: right;">${submission.totalVolume || 0}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border}; text-align: right;">${submission.packagesDropped || 0}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border}; text-align: right;">${submission.hubHeroes || 0}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border}; text-align: right;">${submission.packagesSaved || 0}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border};">${submission.reason || '-'}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border};">${submission.station || '-'}</td>
                <td style="padding: 10px; border: 1px solid ${theme.border};">${submission.openTicket || '-'}</td>
            `;
            tbody.appendChild(row);
        });

        // Actualizar gráficos y tabla de stations
        updateCharts();
        updateStationsTable();
    }

    // Función para descargar CSV
    function downloadCSV() {
        const headers = ['Submission Date', 'Login', 'Store', 'Total Volume', 'Packages Dropped', 'Hub Heroes', 'Packages Saved', 'Reason', 'Station', 'Open Ticket'];
        
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toLocaleString('es-ES', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        const rows = filteredSubmissions.map(s => [
            formatDate(s.submissionDate),
            s.login || '',
            s.store || '',
            s.totalVolume || 0,
            s.packagesDropped || 0,
            s.hubHeroes || 0,
            s.packagesSaved || 0,
            s.reason || '',
            s.station || '',
            s.openTicket || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'hub_heroes_data.csv';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // Función para actualizar la tabla de stations
    function updateStationsTable() {
        const theme = THEMES[currentTheme];
        const stationData = {};

        // Filtrar y agrupar por station
        filteredSubmissions
            .filter(s => s.hubHeroes === 'BACK TO STATION' || s.hubHeroes === 'STAY IN STORE')
            .forEach(s => {
                const station = s.station || 'Unknown';
                if (!stationData[station]) {
                    stationData[station] = {
                        packagesNotSaved: 0,
                        storesReasons: []
                    };
                }
                stationData[station].packagesNotSaved += parseInt(s.packagesDropped) || 0;
                if (s.store && s.reason) {
                    stationData[station].storesReasons.push(`${s.store} (${s.reason})`);
                }
            });

        // Actualizar tabla
        const tbody = document.getElementById('stations-tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '';

        const stations = Object.keys(stationData).sort();
        stations.forEach((station, index) => {
            const data = stationData[station];
            const row = document.createElement('tr');
            row.style.cssText = `background: ${index % 2 === 0 ? theme.tableRowEven : theme.tableRowOdd}; color: ${theme.text};`;
            row.innerHTML = `
                <td style="padding: 8px; border: 1px solid ${theme.border};">${station}</td>
                <td style="padding: 8px; border: 1px solid ${theme.border}; text-align: right;">${data.packagesNotSaved}</td>
                <td style="padding: 8px; border: 1px solid ${theme.border};">${data.storesReasons.join(', ')}</td>
            `;
            tbody.appendChild(row);
        });
    }

    // Función para actualizar los gráficos
    function updateCharts() {
        const theme = THEMES[currentTheme];
        
        // Destruir gráficos existentes
        if (chartInstances.reason) chartInstances.reason.destroy();
        if (chartInstances.packages) chartInstances.packages.destroy();

        // Gráfico de Reasons
        const reasonCounts = {};
        filteredSubmissions.forEach(s => {
            const reason = s.reason || 'Sin especificar';
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });

        const ctx1 = document.getElementById('reasonChart').getContext('2d');
        chartInstances.reason = new Chart(ctx1, {
            type: 'pie',
            data: {
                labels: Object.keys(reasonCounts),
                datasets: [{
                    data: Object.values(reasonCounts),
                    backgroundColor: ['#232F3E', '#146EB4', '#FF9900', '#F2F2F2', '#000000', '#87CEEB', '#90EE90']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Split by Reason',
                        font: { size: 16, weight: 'bold' },
                        color: theme.text
                    },
                    legend: { 
                        position: 'bottom',
                        labels: { color: theme.text }
                    }
                }
            }
        });

        // Gráfico de Packages
        const totalDropped = filteredSubmissions.reduce((sum, s) => sum + (parseInt(s.packagesDropped) || 0), 0);
        const totalSaved = filteredSubmissions.reduce((sum, s) => sum + (parseInt(s.packagesSaved) || 0), 0);

        const ctx2 = document.getElementById('packagesChart').getContext('2d');
        chartInstances.packages = new Chart(ctx2, {
            type: 'pie',
            data: {
                labels: ['Packages Dropped', 'Packages Saved'],
                datasets: [{
                    data: [totalDropped, totalSaved],
                    backgroundColor: ['#FF9900', '#146EB4']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Packages Dropped vs Saved',
                        font: { size: 16, weight: 'bold' },
                        color: theme.text
                    },
                    legend: { 
                        position: 'bottom',
                        labels: { color: theme.text }
                    }
                }
            }
        });
    }

    // Inicializar cuando la página esté lista
    function init() {
        // Esperar a que el DOM esté completamente cargado
        const observer = new MutationObserver((mutations, obs) => {
            const settingsTab = document.querySelector('[data-testid="Settings-tab"]');
            if (settingsTab) {
                addDashboardTab();
                obs.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Intentar añadir inmediatamente si ya está disponible
        if (document.querySelector('[data-testid="Settings-tab"]')) {
            addDashboardTab();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();




