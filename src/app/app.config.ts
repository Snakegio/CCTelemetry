import {ApplicationConfig, provideBrowserGlobalErrorListeners} from '@angular/core';
import {provideRouter} from '@angular/router';
import {providePrimeNG} from "primeng/config";
import { AppPreset } from './theme/preset';
import { routes } from './app.route';

export const appConfig: ApplicationConfig = {
    providers: [provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        providePrimeNG({
            theme: {
                preset: AppPreset,
                options: {
                    cssLayer: { name: 'primeng', order: 'theme, base, primeng, utilities' },
                },
            },
            license: 'eyJpZCI6IjQyNmJhY2M1LWQ5M2YtNDBiZS04ZTZlLWM0MzRkYzQyMzlhZCIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3ODM3MDQyMTAsImV4cCI6MTgxNTI0MDIxMH0.eY_1_A9YeSKMtlaulnPKdwCxncVo3YWvJYLnMQu6-V-u6fkRYnm52dGV6aYQC3sSYC0y7mGmHMY97ZIqjGjHDA'
        })
    ],
};
